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
  ) {}

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
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
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

    const coords = await this.geocode(dto.address, dto.state);
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

    if (dto.address !== customer.address || dto.state !== customer.state) {
        const coords = await this.geocode(dto.address, dto.state);
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
    const { page = 1, limit = 10, search, status, type } = query;
    const skip = (page - 1) * limit;

    // Search by customer name requires $lookup or searching in objects
    // For simplicity, we filter orders and then search customer if needed, 
    // but better to use aggregate for full search capability.
    
    const filter: any = {};
    if (status) filter.status = status;
    if (type) filter.type = type;

    // Use aggregate for search by customer name
    if (search) {
        const pipeline: any[] = [
            { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerData' } },
            { $unwind: '$customerData' },
            { 
              $match: {
                $or: [
                    { 'customerData.name': { $regex: search, $options: 'i' } },
                    { notes: { $regex: search, $options: 'i' } }
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
            { $addFields: { customer: '$customerData' } },
            { $project: { customerData: 0 } }
        ];

        const data = await this.orderModel.aggregate(pipeline).exec();
        
        // Count for search
        const totalPipeline = [
            { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerData' } },
            { $unwind: '$customerData' },
            { 
              $match: {
                $or: [
                    { 'customerData.name': { $regex: search, $options: 'i' } },
                    { notes: { $regex: search, $options: 'i' } }
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
    // Existence check for agents
    const leadAgent = await this.userModel.findById(dto.leadAgentId).exec();
    const closerAgent = await this.userModel.findById(dto.closerAgentId).exec();

    if (!leadAgent) {
      throw new NotFoundException('الموظف الذي جلب العميل غير موجود - CREATE');
    }
    if (!closerAgent) {
      throw new NotFoundException('الموظف الذي أغلق الطلب غير موجود - CREATE');
    }

    let customerId = dto.customerId ? new Types.ObjectId(dto.customerId) : null;

    // Handle new customer
    if (dto.newCustomer) {
      const existing = await this.customerModel.findOne({ phone: dto.newCustomer.phone }).exec();
      if (existing) throw new BadRequestException('العميل برقم الهاتف هذا موجود بالفعل');

      const coords = await this.geocode(dto.newCustomer.address, dto.newCustomer.state);
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
    });

    const savedOrder = await order.save();
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
      if (!leadAgent) throw new NotFoundException('الموظف الذي جلب العميل غير موجود - UPDATE');
      updateData.leadAgent = new Types.ObjectId(dto.leadAgentId);
    }

    if (dto.closerAgentId && dto.closerAgentId !== 'undefined') {
      const closerAgent = await this.userModel.findById(dto.closerAgentId).exec();
      if (!closerAgent) throw new NotFoundException('الموظف الذي أغلق الطلب غير موجود - UPDATE');
      updateData.closerAgent = new Types.ObjectId(dto.closerAgentId);
    }

    if (dto.customerId) {
      updateData.customer = new Types.ObjectId(dto.customerId);
    }

    const updated = await this.orderModel.findByIdAndUpdate(id, updateData, { new: true }).exec();

    await this.invalidateDashboardCache();
    return updated;
  }

  async removeOrder(id: string) {
    const result = await this.orderModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('الطلب غير موجود');
    await this.invalidateDashboardCache();
    return { success: true };
  }

  async removeCustomer(id: string) {
    const result = await this.customerModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('العميل غير موجود');
    
    // Optional: Also remove orders for this customer? 
    // Usually better to keep them or restrict deletion if they have orders.
    // For now, just delete the customer.
    await this.invalidateDashboardCache();
    return { success: true };
  }

  // --- Geocoding Helpers ---

  async geocode(address?: string, state?: string) {
    if (!address || !state) return null;
    try {
      const query = encodeURIComponent(`${address}, ${state}`);
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

    // KPIs
    const totalOrders = await this.orderModel.countDocuments({ createdAt: { $gte: startDate } }).exec();
    const prevOrders = await this.orderModel.countDocuments({ createdAt: { $gte: prevStartDate, $lt: startDate } }).exec();

    const revenueResultArr = await this.orderModel.aggregate([
      { $match: { status: OrderStatus.COMPLETED, createdAt: { $gte: startDate } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).exec();
    const revenueResult = revenueResultArr[0] || { total: 0 };
    
    const prevRevenueResultArr = await this.orderModel.aggregate([
      { $match: { status: OrderStatus.COMPLETED, createdAt: { $gte: prevStartDate, $lt: startDate } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).exec();
    const prevRevenueResult = prevRevenueResultArr[0] || { total: 0 };

    const totalCustomers = await this.customerModel.countDocuments({ createdAt: { $gte: startDate } }).exec();
    const prevCustomers = await this.customerModel.countDocuments({ createdAt: { $gte: prevStartDate, $lt: startDate } }).exec();

    const totalLeads = await this.leadModel.countDocuments({ createdAt: { $gte: startDate } }).exec();
    const prevLeads = await this.leadModel.countDocuments({ createdAt: { $gte: prevStartDate, $lt: startDate } }).exec();

    const recentOrders = await this.orderModel.find()
      .populate('customer', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(now.getMonth() - 11);
    twelveMonthsAgo.setDate(1);

    const revenueByMonth = await this.orderModel.aggregate([
      { $match: { status: OrderStatus.COMPLETED, createdAt: { $gte: twelveMonthsAgo } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          revenue: { $sum: '$amount' }
      }},
      { $sort: { _id: 1 } },
      { $project: { month: '$_id', revenue: 1, _id: 0 } }
    ]).exec();

    const topAgents = await this.orderModel.aggregate([
      { $match: { status: OrderStatus.COMPLETED, createdAt: { $gte: startDate } } },
      { $group: {
          _id: '$closerAgent',
          totalRevenue: { $sum: '$amount' },
          orderCount: { $sum: 1 }
      }},
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'agent' } },
      { $unwind: '$agent' },
      { $project: { name: '$agent.name', totalRevenue: 1, orderCount: 1, _id: 0 } },
      { $sort: { totalRevenue: -1 } },
      { $limit: 5 }
    ]).exec();

    const ordersByType = await this.orderModel.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $project: { type: '$_id', count: 1, _id: 0 } }
    ]).exec();
    
    const leadsFunnel = await this.leadModel.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { status: '$_id', count: 1, _id: 0 } }
    ]).exec();

    const topStates = await this.orderModel.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerData' } },
      { $unwind: '$customerData' },
      { $group: { _id: '$customerData.state', count: { $sum: 1 } } },
      { $project: { name: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]).exec();

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
      throw new NotFoundException('Order not found');
    }
    
    const customerEmail = (order.customer as any).email;
    if (!customerEmail) {
      console.error(`[Invoice] Customer ${(order.customer as any).name} has no email`);
      throw new BadRequestException('Customer does not have an email address');
    }

    console.log(`[Invoice] Generating PDF buffer...`);
    const settings = await this.getInvoiceSettings();
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await this.invoicePdfService.generateInvoiceBuffer(order, settings);
      console.log(`[Invoice] PDF buffer generated successfully (Size: ${pdfBuffer.length} bytes)`);
    } catch (pdfError) {
      console.error(`[Invoice] PDF generation FAILED:`, pdfError);
      throw new Error(`Failed to generate PDF: ${pdfError.message}`);
    }

    const subject = `Invoice for Order #${order._id} - EN TEC`;
    const text = `Dear ${(order.customer as any).name},\n\nPlease find attached the invoice for your order #${order._id}.\n\nThank you for your business!`;

    console.log(`[Invoice] Sending email to ${customerEmail}...`);
    try {
      await this.emailService.sendMail(customerEmail, subject, text, [
        {
          filename: `Invoice-INV-${order._id}.pdf`,
          content: pdfBuffer,
        },
      ]);
      console.log(`[Invoice] Email sent SUCCESSFULLY to ${customerEmail}`);
    } catch (emailError) {
      console.error(`[Invoice] Email sending FAILED to ${customerEmail}:`, emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    return { success: true, email: customerEmail };
  }
}
