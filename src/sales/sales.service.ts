import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CacheService } from '../common/cache.service';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { Order, OrderDocument } from './schemas/order.schema';
import { InvoiceSettings, InvoiceSettingsDocument } from './schemas/invoice-settings.schema';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateCustomerDto, UpdateCustomerDto, CreateOrderDto, UpdateOrderDto, QueryOrdersDto, QueryCustomersDto, DashboardQueryDto } from './sales.dto';
import { OrderStatus } from './order-status.enum';
import { EmailService } from '../email/email.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';

@Injectable()
export class SalesService {
  constructor(
    @InjectModel(Customer.name)
    private customerModel: Model<CustomerDocument>,
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,
    @InjectModel(InvoiceSettings.name)
    private invoiceSettingsModel: Model<InvoiceSettingsDocument>,
    @InjectModel(Lead.name)
    private leadModel: Model<LeadDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private cacheService: CacheService,
    private emailService: EmailService,
    private invoicePdfService: InvoicePdfService,
    private workSettingsService: WorkSettingsService,
  ) { }

  // --- Invoice Settings ---

  async getInvoiceSettings(): Promise<InvoiceSettingsDocument> {
    let settings = await this.invoiceSettingsModel.findOne().exec();
    if (!settings) {
      settings = await new this.invoiceSettingsModel({}).save();
    }
    return settings;
  }

  async updateInvoiceSettings(dto: Partial<InvoiceSettings>): Promise<InvoiceSettingsDocument> {
    const settings = await this.getInvoiceSettings();
    const updated = await this.invoiceSettingsModel.findByIdAndUpdate(settings._id, dto, { new: true }).exec();
    if (!updated) throw new NotFoundException('إعدادات الفاتورة غير موجودة');
    return updated;
  }

  // --- Customers ---

  async findAllCustomers(query: QueryCustomersDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const { search } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { phone: { $regex: escapedSearch, $options: 'i' } },
        { email: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    const data = await this.customerModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    const total = await this.customerModel.countDocuments(filter).exec();

    return { data, total, page, limit };
  }

  async findOneCustomer(id: string) {
    const customer = await this.customerModel.findById(id).exec();
    if (!customer) throw new NotFoundException('العميل غير موجود');

    // In SQL we had relations: ['orders', 'orders.devices']
    // In Mongo we can find orders separately or use aggregate
    console.log('Finding orders for customer ID:', id);
    const orders = await this.orderModel.find({ customer: new Types.ObjectId(id) }).exec();
    console.log('Found orders:', orders.length);

    const result = customer.toObject() as any;
    result.orders = orders;
    return result;
  }

  async createCustomer(dto: CreateCustomerDto) {
    const existing = await this.customerModel.findOne({ phone: dto.phone }).exec();
    if (existing) throw new BadRequestException('العميل برقم الهاتف هذا موجود بالفعل');

    const coords = await this.geocode(dto.address, dto.state, dto.country);
    const customer = new this.customerModel({
      ...dto,
      latitude: coords?.latitude || dto.latitude,
      longitude: coords?.longitude || dto.longitude,
    });
    return customer.save();
  }

  async updateCustomer(id: string, dto: UpdateCustomerDto) {
    const customer = await this.customerModel.findById(id).exec();
    if (!customer) throw new NotFoundException('العميل غير موجود');

    if (dto.phone && dto.phone !== customer.phone) {
      const existing = await this.customerModel.findOne({ phone: dto.phone }).exec();
      if (existing) throw new BadRequestException('العميل برقم الهاتف هذا موجود بالفعل');
    }

    if (dto.address !== customer.address || dto.state !== customer.state || dto.country !== customer.country) {
      const coords = await this.geocode(dto.address, dto.state, dto.country);
      if (coords) {
        (dto as any).latitude = coords.latitude;
        (dto as any).longitude = coords.longitude;
      }
    }

    const updated = await this.customerModel.findByIdAndUpdate(id, dto, { new: true }).exec();
    await this.invalidateDashboardCache();
    return updated;
  }

  // --- Orders ---

  async findAllOrders(query: QueryOrdersDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const { search, status, type } = query;
    const skip = (page - 1) * limit;

    // Search by customer name requires $lookup or searching in objects
    // For simplicity, we filter orders and then search customer if needed, 
    // but better to use aggregate for full search capability.

    const filter: any = {};
    if (status) filter.status = status;
    if (type) filter.type = type;

    // Use aggregate for search by customer name
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pipeline: any[] = [
        { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerData' } },
        { $unwind: '$customerData' },
        { $addFields: { stringId: { $toString: '$_id' } } },
        {
          $match: {
            $or: [
              { 'customerData.name': { $regex: escapedSearch, $options: 'i' } },
              { 'customerData.phone': { $regex: escapedSearch, $options: 'i' } },
              { notes: { $regex: escapedSearch, $options: 'i' } },
              { stringId: { $regex: escapedSearch, $options: 'i' } }
            ],
            ...filter
          }
        },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $lookup: { from: 'users', localField: 'leadAgent', foreignField: '_id', as: 'leadAgent' } },
        { $lookup: { from: 'users', localField: 'closerAgent', foreignField: '_id', as: 'closerAgent' } },
        { $unwind: { path: '$leadAgent', preserveNullAndEmptyArrays: true } },
        { $unwind: { path: '$closerAgent', preserveNullAndEmptyArrays: true } },
        { $addFields: { 
            customer: {
                $mergeObjects: [
                    '$customerData',
                    { 
                        id: { 
                            $cond: {
                                if: { $gt: ['$customerData._id', null] },
                                then: { $toString: '$customerData._id' },
                                else: null
                            }
                        }
                    }
                ]
            },
            id: { $toString: '$_id' }
        } },
        { $project: { customerData: 0 } }
      ];

      const data = await this.orderModel.aggregate(pipeline).exec();

      // Count for search
      const totalPipeline = [
        { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerData' } },
        { $unwind: '$customerData' },
        { $addFields: { stringId: { $toString: '$_id' } } },
        {
          $match: {
            $or: [
              { 'customerData.name': { $regex: escapedSearch, $options: 'i' } },
              { 'customerData.phone': { $regex: escapedSearch, $options: 'i' } },
              { notes: { $regex: escapedSearch, $options: 'i' } },
              { stringId: { $regex: escapedSearch, $options: 'i' } }
            ],
            ...filter
          }
        },
        { $count: 'total' }
      ];
      const totalResult = await this.orderModel.aggregate(totalPipeline).exec();
      const total = totalResult.length > 0 ? totalResult[0].total : 0;

      return { data, total, page, limit };
    }

    const data = await this.orderModel.find(filter)
      .populate('customer leadAgent closerAgent')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    const total = await this.orderModel.countDocuments(filter).exec();

    return { data, total, page, limit };
  }

  async findOneOrder(id: string) {
    const order = await this.orderModel.findById(id)
      .populate('customer leadAgent closerAgent')
      .exec();
    if (!order) throw new NotFoundException('الطلب غير موجود');
    return order;
  }

  async createOrder(dto: CreateOrderDto) {
    // Existence check for agents (Relaxed)
    const leadAgent = dto.leadAgentId ? await this.userModel.findById(dto.leadAgentId).exec() : null;
    const closerAgent = dto.closerAgentId ? await this.userModel.findById(dto.closerAgentId).exec() : null;

    let customerId = dto.customerId ? new Types.ObjectId(dto.customerId) : null;

    // Handle new customer
    if (dto.newCustomer) {
      const existing = await this.customerModel.findOne({ phone: dto.newCustomer.phone }).exec();
      if (existing) throw new BadRequestException('العميل برقم الهاتف هذا موجود بالفعل');

      const coords = await this.geocode(dto.newCustomer.address, dto.newCustomer.state, dto.newCustomer.country);
      const newCustomer = new this.customerModel({
        ...dto.newCustomer,
        latitude: coords?.latitude || dto.newCustomer.latitude,
        longitude: coords?.longitude || dto.newCustomer.longitude,
      });
      const savedCustomer = await newCustomer.save();
      customerId = savedCustomer._id as Types.ObjectId;
    }

    if (!customerId) throw new BadRequestException('يجب تحديد عميل أو إدخال بيانات عميل جديد');

    const order = new this.orderModel({
      ...dto,
      customer: customerId,
      leadAgent: new Types.ObjectId(dto.leadAgentId),
      closerAgent: new Types.ObjectId(dto.closerAgentId),
      devices: dto.devices || [],
      subscriptionDate: dto.subscriptionDate ? new Date(dto.subscriptionDate) : new Date(),
    });

    const savedOrder = await order.save();
    await savedOrder.populate('customer leadAgent closerAgent');
    await this.invalidateDashboardCache();
    return savedOrder;
  }

  async updateOrder(id: string, dto: UpdateOrderDto) {
    console.log('UpdateOrder for ID:', id);
    console.log('DTO contents:', JSON.stringify(dto));
    console.log('leadAgentId type:', typeof dto.leadAgentId);
    console.log('leadAgentId value:', dto.leadAgentId);
    const order = await this.orderModel.findById(id).exec();
    if (!order) throw new NotFoundException('الطلب غير موجود');

    const updateData: any = { ...dto };

    if (dto.leadAgentId && dto.leadAgentId !== 'undefined') {
      const leadAgent = await this.userModel.findById(dto.leadAgentId).exec();
      if (leadAgent) {
        updateData.leadAgent = new Types.ObjectId(dto.leadAgentId);
      }
    }

    if (dto.closerAgentId && dto.closerAgentId !== 'undefined') {
      const closerAgent = await this.userModel.findById(dto.closerAgentId).exec();
      if (closerAgent) {
        updateData.closerAgent = new Types.ObjectId(dto.closerAgentId);
      }
    }

    if (dto.customerId) {
      updateData.customer = new Types.ObjectId(dto.customerId);
    }

    if (dto.subscriptionDate) {
      updateData.subscriptionDate = new Date(dto.subscriptionDate);
    }

    const updated = await this.orderModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
    if (updated) {
      await updated.populate('customer leadAgent closerAgent');
    }
    await this.invalidateDashboardCache();
    return updated;
  }

  async removeOrder(id: string) {
    const result = await this.orderModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('الطلب غير موجود');
    await this.invalidateDashboardCache();
    return { success: true };
  }

  async exportOrdersToExcel() {
    const orders = await this.orderModel.find()
      .populate('customer leadAgent closerAgent')
      .sort({ createdAt: -1 })
      .exec();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('المبيعات');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 25 },
      { header: 'اسم العميل', key: 'customerName', width: 25 },
      { header: 'هاتف العميل', key: 'customerPhone', width: 15 },
      { header: 'تاريخ الاشتراك', key: 'subscriptionDate', width: 15 },
      { header: 'المبلغ', key: 'amount', width: 10 },
      { header: 'نوع الطلب', key: 'type', width: 10 },
      { header: 'الحالة', key: 'status', width: 10 },
      { header: 'طريقة الدفع', key: 'paymentMethod', width: 15 },
      { header: 'موظف الجذب', key: 'leadAgent', width: 20 },
      { header: 'البريد الإلكتروني', key: 'customerEmail', width: 25 },
      { header: 'العنوان', key: 'customerAddress', width: 30 },
      { header: 'الولاية', key: 'customerState', width: 15 },
      { header: 'الدولة', key: 'customerCountry', width: 15 },
      { header: 'خط العرض (Lat)', key: 'customerLat', width: 12 },
      { header: 'خط الطول (Lng)', key: 'customerLng', width: 12 },
      { header: 'تاريخ الاشتراك (تاريخ البيع)', key: 'subscriptionDate', width: 18 },
      { header: 'المبلغ', key: 'amount', width: 12 },
      { header: 'نوع الطلب', key: 'type', width: 12 },
      { header: 'الحالة', key: 'status', width: 12 },
      { header: 'طريقة الدفع', key: 'paymentMethod', width: 15 },
      { header: 'الموظف (Lead)', key: 'leadAgent', width: 20 },
      { header: 'موظف الإغلاق', key: 'closerAgent', width: 20 },
      { header: 'اسم السيرفر', key: 'serverName', width: 15 },
      { header: 'تاريخ انتهاء السيرفر', key: 'serverExpiryDate', width: 15 },
      { header: 'نوع التطبيق', key: 'appType', width: 15 },
      { header: 'عدد السنوات', key: 'appYears', width: 10 },
      { header: 'تاريخ انتهاء التطبيق', key: 'appExpiryDate', width: 15 },
      { header: 'اسم الموصي (Referrer)', key: 'referrerName', width: 20 },
      { header: 'جهاز 1 - MAC', key: 'd1_mac', width: 18 },
      { header: 'جهاز 1 - Key', key: 'd1_key', width: 15 },
      { header: 'جهاز 1 - اسم', key: 'd1_name', width: 15 },
      { header: 'جهاز 2 - MAC', key: 'd2_mac', width: 18 },
      { header: 'جهاز 3 - MAC', key: 'd3_mac', width: 18 },
      { header: 'جهاز 4 - MAC', key: 'd4_mac', width: 18 },
      { header: 'جهاز 5 - MAC', key: 'd5_mac', width: 18 },
      { header: 'المرفقات (روابط)', key: 'attachments', width: 40 },
      { header: 'رابط الفاتورة', key: 'invoiceFile', width: 40 },
      { header: 'ملاحظات', key: 'notes', width: 30 },
    ];

    orders.forEach(order => {
      const rowData: any = {
        id: order._id.toString(),
        customerName: (order.customer as any)?.name || '',
        customerPhone: (order.customer as any)?.phone || '',
        customerEmail: (order.customer as any)?.email || '',
        customerAddress: (order.customer as any)?.address || '',
        customerState: (order.customer as any)?.state || '',
        customerCountry: (order.customer as any)?.country || '',
        customerLat: (order.customer as any)?.latitude || '',
        customerLng: (order.customer as any)?.longitude || '',
        subscriptionDate: order.subscriptionDate ? order.subscriptionDate.toISOString().split('T')[0] : (order as any).createdAt?.toISOString().split('T')[0],
        amount: order.amount,
        type: order.type,
        status: order.status,
        paymentMethod: order.paymentMethod,
        leadAgent: (order.leadAgent as any)?.name || '',
        closerAgent: (order.closerAgent as any)?.name || '',
        serverName: order.serverName || '',
        serverExpiryDate: order.serverExpiryDate ? order.serverExpiryDate.toISOString().split('T')[0] : '',
        appType: order.appType || '',
        appYears: order.appYears || '',
        appExpiryDate: order.appExpiryDate ? (typeof order.appExpiryDate === 'string' ? order.appExpiryDate : (order.appExpiryDate as any).toISOString().split('T')[0]) : '',
        referrerName: order.referrerName || '',
        attachments: (order.attachments || []).join(', '),
        invoiceFile: order.invoiceFile || '',
        notes: order.notes || '',
      };

      if (order.devices && order.devices.length > 0) {
        order.devices.forEach((d, idx) => {
          if (idx < 5) {
            rowData[`d${idx + 1}_mac`] = d.macAddress;
            rowData[`d${idx + 1}_key`] = d.deviceKey;
            rowData[`d${idx + 1}_name`] = d.deviceName;
          }
        });
      }

      worksheet.addRow(rowData);
    });

    return await workbook.xlsx.writeBuffer();
  }

  async importOrdersFromExcel(fileBuffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as any);
    const worksheet = workbook.getWorksheet(1);

    const results: { success: number; failed: number; errors: string[] } = {
      success: 0,
      failed: 0,
      errors: []
    };

    if (!worksheet) return results;

    const agents = await this.userModel.find({ role: { $in: ['admin', 'agent'] } }).exec();

    // Mapping helpers
    const mapType = (val: string): string => {
      if (!val) return 'new';
      const v = val.toLowerCase();
      if (v.includes('تجديد')) return 'renewal';
      if (v.includes('توصية') || v.includes('referral')) return 'referral';
      return 'new';
    };

    const parseDate = (val: any): Date => {
      if (!val) return new Date();
      if (val instanceof Date) return val;
      if (typeof val === 'number') {
        // Excel serial date
        return new Date(Math.round((val - 25569) * 86400 * 1000));
      }
      const d = new Date(val);
      return isNaN(d.getTime()) ? new Date() : d;
    };

    let lastValidCustomer: any = null;
    let lastOrder: any = null;
    const companyAgent = agents.find(a => a.name?.toLowerCase() === 'company');

    // Process rows - Start from 3 because of double header
    for (let i = 3; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const rowId = row.getCell(1).value?.toString()?.trim();
      const customerName = row.getCell(2).value?.toString()?.trim();
      
      if (!customerName) continue;

      try {
        const mac = row.getCell(19).value?.toString();
        const key = row.getCell(20).value?.toString();
        const dName = row.getCell(21).value?.toString();
        const device = { 
          macAddress: mac || '', 
          deviceKey: key || '', 
          deviceName: dName || '',
          username: customerName 
        };

        // If no ID in Column 1, it's an additional device for the last order
        if (!rowId && lastOrder) {
          if (mac || key) {
            lastOrder.devices.push(device);
            await lastOrder.save();
            results.success++;
          }
          continue;
        }

        // Otherwise, it's a new order
        let customerPhone = row.getCell(3).value?.toString()?.replace(/\D/g, '');
        const customerEmail = row.getCell(4).value?.toString();
        const customerAddress = row.getCell(5).value?.toString();
        const customerCountry = row.getCell(6).value?.toString();
        const customerState = row.getCell(7).value?.toString();

        const leadAgentName = row.getCell(8).value?.toString();
        const closerAgentName = row.getCell(9).value?.toString();
        const typeStr = row.getCell(10).value?.toString();
        const amount = Number(row.getCell(11).value) || 0;
        const paymentMethod = row.getCell(12).value?.toString() || 'cash';
        const subDate = parseDate(row.getCell(13).value);

        const serverName = row.getCell(14).value?.toString();
        const serverExpiryDate = parseDate(row.getCell(15).value);
        const appType = row.getCell(16).value?.toString();
        const appYears = Number(row.getCell(17).value) || 1;
        const appExpiryDate = parseDate(row.getCell(18).value);

        // 1. Find or Create Customer
        let customer: any = null;
        if (customerPhone) {
          customer = await this.customerModel.findOne({ phone: customerPhone }).exec();
          if (!customer) {
            customer = new this.customerModel({
              name: customerName,
              phone: customerPhone,
              email: customerEmail,
              address: customerAddress,
              state: customerState,
              country: customerCountry
            });
            await customer.save();
            
            // Trigger geocoding asynchronously
            if (customerAddress) {
              this.geocode(customerAddress, customerState, customerCountry).then(coords => {
                if (coords) {
                  this.customerModel.findByIdAndUpdate(customer._id, { 
                    latitude: coords.latitude, 
                    longitude: coords.longitude 
                  }).exec();
                }
              }).catch(e => console.error('Geocoding failed during import:', e));
            }
          }
          lastValidCustomer = customer;
        } else if (lastValidCustomer) {
          customer = lastValidCustomer;
        } else {
          customer = await this.customerModel.findOne({ name: customerName }).exec();
          if (!customer) {
             throw new Error('رقم الهاتف مطلوب للعملاء الجدد');
          }
        }

        // 2. Map Agents
        const leadAgent = agents.find(a => a.name === leadAgentName || a.email === leadAgentName);
        const closerAgent = agents.find(a => a.name === closerAgentName || a.email === closerAgentName);

        // 3. Create Order
        const order = new this.orderModel({
          customer: customer?._id,
          subscriptionDate: subDate,
          amount,
          type: mapType(typeStr || ''),
          status: 'completed',
          paymentMethod,
          leadAgent: leadAgent?._id || companyAgent?._id || agents[0]?._id,
          closerAgent: closerAgent?._id || companyAgent?._id || agents[0]?._id,
          leadAgentName: leadAgentName || '',
          closerAgentName: closerAgentName || '',
          serverName,
          serverExpiryDate,
          appType,
          appYears,
          appExpiryDate,
          devices: (mac || key) ? [device] : []
        });

        lastOrder = await order.save();
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`Row ${i} (${customerName}): ${err.message}`);
      }
    }

    await this.invalidateDashboardCache();
    return results;
  }

  async removeCustomer(id: string) {
    try {
      console.log(`[SalesService] Attempting to remove customer: ${id}`);
      const result = await this.customerModel.findByIdAndDelete(id).exec();
      console.log(`[SalesService] Delete result:`, result ? 'Found and deleted' : 'Not found');
      if (!result) throw new NotFoundException('العميل غير موجود');
      await this.invalidateDashboardCache();
      return { success: true };
    } catch (error) {
      console.error(`[SalesService] CRITICAL Error removing customer ${id}:`, error);
      throw error;
    }
  }

  // --- Geocoding Helpers ---

  async geocode(address?: string, state?: string, country?: string) {
    if (!address) return null;
    try {
      // Build a more robust query
      let queryStr = address;
      if (state) queryStr += `, ${state}`;
      if (country) queryStr += `, ${country}`;

      const query = encodeURIComponent(queryStr);
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`, {
        headers: { 'User-Agent': 'EN-TEC-CRM/1.0' }
      });
      const data: any = await response.json();
      if (data && data.length > 0) {
        return {
          latitude: parseFloat(data[0].lat),
          longitude: parseFloat(data[0].lon)
        };
      }
    } catch (error) {
      console.error('Geocoding error:', error);
    }
    return null;
  }

  // --- Dashboard ---

  async invalidateDashboardCache() {
    await this.cacheService.invalidateByPattern('dashboard:stats:*');
  }

  async getDashboardStats(query: DashboardQueryDto) {
    const { period = '30days' } = query;
    const cacheKey = `dashboard:stats:${period}`;

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const stats = await this.computeDashboardStats(period);

    await this.cacheService.set(cacheKey, stats, 300);

    return stats;
  }

  async refreshDashboardCache() {
    const periods = ['7days', '30days', 'ytd', 'all'];
    for (const period of periods) {
      try {
        const stats = await this.computeDashboardStats(period);
        await this.cacheService.set(`dashboard:stats:${period}`, stats, 600);
      } catch (error) { }
    }
  }

  async computeDashboardStats(period: string) {
    const now = new Date();
    let startDate = new Date();
    let prevStartDate = new Date();

    if (period === '7days') {
      startDate.setDate(now.getDate() - 7);
      prevStartDate.setDate(now.getDate() - 14);
    } else if (period === 'ytd') {
      startDate = new Date(now.getFullYear(), 0, 1);
      prevStartDate = new Date(now.getFullYear() - 1, 0, 1);
    } else if (period === 'all') {
      startDate = new Date(2020, 0, 1);
      prevStartDate = new Date(2020, 0, 1);
    } else {
      startDate.setDate(now.getDate() - 30);
      prevStartDate.setDate(now.getDate() - 60);
    }

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(now.getMonth() - 11);
    twelveMonthsAgo.setDate(1);

    // Execute all independent queries concurrently
    const [
      totalOrders,
      prevOrders,
      revenueResultArr,
      prevRevenueResultArr,
      totalCustomers,
      prevCustomers,
      totalLeads,
      prevLeads,
      recentOrders,
      revenueByMonth,
      topAgents,
      ordersByType,
      leadsFunnel,
      topStates
    ] = await Promise.all([
      this.orderModel.countDocuments({ createdAt: { $gte: startDate } }).exec(),
      this.orderModel.countDocuments({ createdAt: { $gte: prevStartDate, $lt: startDate } }).exec(),
      this.orderModel.aggregate([
        { $match: { status: OrderStatus.COMPLETED, createdAt: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]).exec(),
      this.orderModel.aggregate([
        { $match: { status: OrderStatus.COMPLETED, createdAt: { $gte: prevStartDate, $lt: startDate } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]).exec(),
      this.customerModel.countDocuments({ createdAt: { $gte: startDate } }).exec(),
      this.customerModel.countDocuments({ createdAt: { $gte: prevStartDate, $lt: startDate } }).exec(),
      this.leadModel.countDocuments({ createdAt: { $gte: startDate } }).exec(),
      this.leadModel.countDocuments({ createdAt: { $gte: prevStartDate, $lt: startDate } }).exec(),
      this.orderModel.find()
        .populate('customer', 'name')
        .sort({ createdAt: -1 })
        .limit(5)
        .exec(),
      this.orderModel.aggregate([
        { $match: { status: OrderStatus.COMPLETED, createdAt: { $gte: twelveMonthsAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            revenue: { $sum: '$amount' }
          }
        },
        { $sort: { _id: 1 } },
        { $project: { month: '$_id', revenue: 1, _id: 0 } }
      ]).exec(),
      this.orderModel.aggregate([
        { $match: { status: OrderStatus.COMPLETED, createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: '$closerAgent',
            totalRevenue: { $sum: '$amount' },
            orderCount: { $sum: 1 }
          }
        },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'agent' } },
        { $unwind: '$agent' },
        { $project: { name: '$agent.name', totalRevenue: 1, orderCount: 1, _id: 0 } },
        { $sort: { totalRevenue: -1 } },
        { $limit: 5 }
      ]).exec(),
      this.orderModel.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $project: { type: '$_id', count: 1, _id: 0 } }
      ]).exec(),
      this.leadModel.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { status: '$_id', count: 1, _id: 0 } }
      ]).exec(),
      this.orderModel.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerData' } },
        { $unwind: '$customerData' },
        { $group: { _id: '$customerData.state', count: { $sum: 1 } } },
        { $project: { name: '$_id', count: 1, _id: 0 } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]).exec()
    ]);

    const revenueResult = revenueResultArr[0] || { total: 0 };
    const prevRevenueResult = prevRevenueResultArr[0] || { total: 0 };

    return {
      kpis: {
        totalOrders,
        prevOrders,
        totalRevenue: revenueResult.total,
        prevRevenue: prevRevenueResult.total,
        totalCustomers,
        prevCustomers,
        totalLeads,
        prevLeads
      },
      recentOrders: recentOrders.map(o => ({
        id: o._id,
        customerName: (o.customer as any)?.name || 'N/A',
        amount: o.amount,
        status: o.status,
        createdAt: o.createdAt
      })),
      revenueByMonth,
      topAgents,
      ordersByType,
      leadsFunnel,
      topStates: topStates.filter(s => s.name).map(s => ({
        name: s.name,
        count: s.count
      }))
    };
  }

  async sendInvoiceToCustomerEmail(orderId: string) {
    console.log(`[Invoice] Starting invoice send process for Order #${orderId}`);
    const order = await this.orderModel.findById(orderId)
      .populate('customer leadAgent closerAgent')
      .exec();

    if (!order) {
      console.error(`[Invoice] Order #${orderId} not found`);
      throw new NotFoundException('الطلب غير موجود');
    }

    const customerEmail = (order.customer as any).email;
    if (!customerEmail) {
      console.error(`[Invoice] Customer ${(order.customer as any).name} has no email`);
      throw new BadRequestException('العميل ليس لديه بريد إلكتروني مسجل');
    }

    let fileBuffer: Buffer;
    let mimeType = 'application/pdf';
    let filename = `Invoice-INV-${order._id}.pdf`;

    if (!order.invoiceFile) {
      console.log(`[Invoice] Order #${orderId} has no invoice file. Generating PDF automatically...`);
      const settings = await this.getInvoiceSettings();
      try {
        fileBuffer = await this.invoicePdfService.generateInvoiceBuffer(order as any, settings);
        console.log(`[Invoice] PDF generated successfully (${Math.round(fileBuffer.length / 1024)}KB)`);
      } catch (genErr) {
        console.error(`[Invoice] Failed to generate PDF:`, genErr);
        throw new BadRequestException(`فشل في إنشاء الفاتورة تلقائياً: ${genErr.message}`);
      }
    } else {
      console.log(`[Invoice] Fetching attached invoice from ${order.invoiceFile}`);
      try {
        const response = await fetch(order.invoiceFile);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type');
        if (contentType) {
          mimeType = contentType.split(';')[0].trim();
        }
        // Infer filename from URL or mime
        const urlParts = order.invoiceFile.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        if (lastPart && lastPart.includes('.')) {
          filename = lastPart;
        } else if (mimeType.includes('image/')) {
          filename = `Invoice-INV-${order._id}.${mimeType.split('/')[1]}`;
        }
        console.log(`[Invoice] File fetched successfully (Size: ${fileBuffer.length} bytes, Type: ${mimeType})`);
      } catch (err) {
        console.error(`[Invoice] Failed to fetch invoice file:`, err);
        throw new Error(`Failed to fetch invoice file: ${err.message}`);
      }
    }

    const subject = `Invoice for Order #${order._id} - EN TEC`;
    const text = `Dear ${(order.customer as any).name},\n\nPlease find attached the invoice for your order #${order._id}.\n\nThank you for your business!`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Thank you for your business!</h2>
        <p>Dear <strong>${(order.customer as any).name}</strong>,</p>
        <p>Please find attached the invoice for your order <strong>#${order._id}</strong>.</p>
        <p>If you have any questions, feel free to reply to this email.</p>
        <br/>
        <p>Best regards,<br/><strong>EN TEC Team</strong></p>
      </div>
    `;

    console.log(`[Invoice] Sending email to ${customerEmail}...`);
    try {
      await this.emailService.sendMail(customerEmail, subject, text, html, [
        {
          filename: filename,
          content: fileBuffer,
          contentType: mimeType
        },
      ]);
      console.log(`[Invoice] Email sent SUCCESSFULLY to ${customerEmail}`);
    } catch (emailError) {
      console.error(`[Invoice] Email sending FAILED to ${customerEmail}:`, emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    return { success: true, email: customerEmail };
  }

  async geocodeAllCustomers() {
    const customers = await this.customerModel.find({
      $or: [
        { latitude: { $exists: false } },
        { latitude: null },
        { longitude: { $exists: false } },
        { longitude: null }
      ],
      address: { $exists: true, $ne: '' }
    }).exec();

    console.log(`[Geocoding] Found ${customers.length} customers needing geocoding.`);
    
    let geocodedCount = 0;
    // Process sequentially with a delay to respect API rate limits
    for (const customer of customers) {
      try {
        const coords = await this.geocode(customer.address, customer.state, customer.country);
        if (coords) {
          await this.customerModel.findByIdAndUpdate(customer._id, {
            latitude: coords.latitude,
            longitude: coords.longitude
          }).exec();
          geocodedCount++;
        }
        // Wait 1 second between requests (Nominatim limit)
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`[Geocoding] Failed for customer ${customer._id}:`, err.message);
      }
    }

    return { 
      success: true, 
      total: customers.length, 
      geocoded: geocodedCount 
    };
  }

  async getAgentCommissions(agentId: string, month?: number, year?: number) {
    const settings = await this.workSettingsService.getSettings();
    const leadRate = settings.leadAgentCommissionRate || 5;
    const closerRate = settings.closerAgentCommissionRate || 10;

    const filter: any = {
      $or: [
        { leadAgent: new Types.ObjectId(agentId) },
        { closerAgent: new Types.ObjectId(agentId) }
      ],
      status: OrderStatus.COMPLETED
    };

    if (month !== undefined && year !== undefined) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      filter.createdAt = { $gte: startDate, $lte: endDate };
    }

    const orders = await this.orderModel.find(filter).populate('customer').exec();

    let totalLeadCommission = 0;
    let totalCloserCommission = 0;
    const orderDetails = orders.map(order => {
      let commission = 0;
      let role = '';

      if (order.leadAgent.toString() === agentId) {
        const amt = (order.amount * leadRate) / 100;
        commission += amt;
        totalLeadCommission += amt;
        role = 'Lead';
      }
      
      if (order.closerAgent.toString() === agentId) {
        const amt = (order.amount * closerRate) / 100;
        commission += amt;
        totalCloserCommission += amt;
        role = role ? 'Both' : 'Closer';
      }

      return {
        orderId: order._id,
        customerName: (order.customer as any)?.name,
        amount: order.amount,
        commission,
        role,
        date: order.createdAt
      };
    });

    return {
      total: totalLeadCommission + totalCloserCommission,
      leadTotal: totalLeadCommission,
      closerTotal: totalCloserCommission,
      count: orders.length,
      orders: orderDetails,
      rates: { leadRate, closerRate }
    };
  }
}
