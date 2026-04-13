import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, DataSource, Between, MoreThanOrEqual } from 'typeorm';
import { CacheService } from '../common/cache.service';
import { Customer } from './customer.entity';
import { Order } from './order.entity';
import { OrderDevice } from './order-device.entity';
import { Lead } from '../leads/lead.entity';
import { User } from '../users/user.entity';
import { CreateCustomerDto, UpdateCustomerDto, CreateOrderDto, UpdateOrderDto, QueryOrdersDto, QueryCustomersDto, DashboardQueryDto } from './sales.dto';
import { OrderStatus } from './order-status.enum';
import { EmailService } from '../email/email.service';
import { InvoicePdfService } from './invoice-pdf.service';

@Injectable()
export class SalesService {
  constructor(
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(OrderDevice)
    private deviceRepository: Repository<OrderDevice>,
    @InjectRepository(Lead)
    private leadRepository: Repository<Lead>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private dataSource: DataSource,
    private cacheService: CacheService,
    private emailService: EmailService,
    private invoicePdfService: InvoicePdfService,
  ) {}

  // --- Customers ---

  async findAllCustomers(query: QueryCustomersDto) {
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;

    const where = search ? [
      { name: Like(`%${search}%`) },
      { phone: Like(`%${search}%`) },
      { email: Like(`%${search}%`) }
    ] : {};

    const [data, total] = await this.customerRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip,
    });

    return { data, total, page, limit };
  }

  async findOneCustomer(id: number) {
    const customer = await this.customerRepository.findOne({
      where: { id },
      relations: ['orders', 'orders.devices'],
    });
    if (!customer) throw new NotFoundException('العميل غير موجود');
    return customer;
  }

  async createCustomer(dto: CreateCustomerDto) {
    const existing = await this.customerRepository.findOne({ where: { phone: dto.phone } });
    if (existing) throw new BadRequestException('العميل برقم الهاتف هذا موجود بالفعل');

    const coords = await this.geocode(dto.address, dto.state);
    const customer = this.customerRepository.create({
      ...dto,
      latitude: coords?.latitude || dto.latitude,
      longitude: coords?.longitude || dto.longitude,
    });
    return this.customerRepository.save(customer);
  }

  async updateCustomer(id: number, dto: UpdateCustomerDto) {
    const customer = await this.findOneCustomer(id);
    
    // Check phone uniqueness if changed
    if (dto.phone && dto.phone !== customer.phone) {
        const existing = await this.customerRepository.findOne({ where: { phone: dto.phone } });
        if (existing) throw new BadRequestException('العميل برقم الهاتف هذا موجود بالفعل');
    }

    // If address changed, re-geocode
    if (dto.address !== customer.address || dto.state !== customer.state) {
        const coords = await this.geocode(dto.address, dto.state);
        if (coords) {
            dto.latitude = coords.latitude;
            dto.longitude = coords.longitude;
        }
    }

    Object.assign(customer, dto);
    const saved = await this.customerRepository.save(customer);
    await this.invalidateDashboardCache();
    return saved;
  }

  // --- Orders ---

  async findAllOrders(query: QueryOrdersDto) {
    const { page = 1, limit = 10, search, status, type } = query;
    const skip = (page - 1) * limit;

    const queryBuilder = this.orderRepository.createQueryBuilder('order')
      .leftJoinAndSelect('order.customer', 'customer')
      .leftJoinAndSelect('order.leadAgent', 'leadAgent')
      .leftJoinAndSelect('order.closerAgent', 'closerAgent')
      .loadRelationCountAndMap('order.deviceCount', 'order.devices');

    if (status) queryBuilder.andWhere('order.status = :status', { status });
    if (type) queryBuilder.andWhere('order.type = :type', { type });
    if (search) {
      queryBuilder.andWhere('(customer.name Like :search OR order.notes Like :search)', { search: `%${search}%` });
    }

    const [data, total] = await queryBuilder
      .orderBy('order.createdAt', 'DESC')
      .take(limit)
      .skip(skip)
      .getManyAndCount();

    return { data, total, page, limit };
  }

  async findOneOrder(id: number) {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['customer', 'leadAgent', 'closerAgent', 'devices'],
    });
    if (!order) throw new NotFoundException('الطلب غير موجود');
    return order;
  }

  async createOrder(dto: CreateOrderDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Existence check for agents
      const leadAgent = await this.userRepository.findOne({ where: { id: dto.leadAgentId } });
      const closerAgent = await this.userRepository.findOne({ where: { id: dto.closerAgentId } });

      if (!leadAgent) {
        throw new NotFoundException('الموظف الذي جلب العميل غير موجود');
      }
      if (!closerAgent) {
        throw new NotFoundException('الموظف الذي أغلق الطلب غير موجود');
      }

      let customerId = dto.customerId;

      // Handle new customer
      if (dto.newCustomer) {
        const existing = await this.customerRepository.findOne({ where: { phone: dto.newCustomer.phone } });
        if (existing) throw new BadRequestException('العميل برقم الهاتف هذا موجود بالفعل');

        const coords = await this.geocode(dto.newCustomer.address, dto.newCustomer.state);
        const newCustomer = this.customerRepository.create({
          ...dto.newCustomer,
          latitude: coords?.latitude || dto.newCustomer.latitude,
          longitude: coords?.longitude || dto.newCustomer.longitude,
        });
        const savedCustomer = await queryRunner.manager.save(newCustomer);
        customerId = savedCustomer.id;
      }

      if (!customerId) throw new BadRequestException('يجب تحديد عميل أو إدخال بيانات عميل جديد');

      const order = this.orderRepository.create({
        ...dto,
        customer: { id: customerId } as any,
        leadAgent: { id: dto.leadAgentId } as any,
        closerAgent: { id: dto.closerAgentId } as any,
        devices: dto.devices || [],
      });

      const savedOrder = await queryRunner.manager.save(order);
      await queryRunner.commitTransaction();
      await this.invalidateDashboardCache();
      return savedOrder;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async updateOrder(id: number, dto: UpdateOrderDto) {
    const order = await this.findOneOrder(id);

    // Existence check for agents
    const leadAgent = await this.userRepository.findOne({ where: { id: dto.leadAgentId } });
    const closerAgent = await this.userRepository.findOne({ where: { id: dto.closerAgentId } });

    if (!leadAgent) {
        throw new NotFoundException('الموظف الذي جلب العميل غير موجود');
    }
    if (!closerAgent) {
        throw new NotFoundException('الموظف الذي أغلق الطلب غير موجود');
    }

    Object.assign(order, {
      ...dto,
      leadAgent: { id: dto.leadAgentId } as any,
      closerAgent: { id: dto.closerAgentId } as any,
    });
    const saved = await this.orderRepository.save(order);
    await this.invalidateDashboardCache();
    return saved;
  }

  async removeOrder(id: number) {
    const order = await this.findOneOrder(id);
    const removed = await this.orderRepository.remove(order);
    await this.invalidateDashboardCache();
    return removed;
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
    
    // Cache for 5 minutes by default
    await this.cacheService.set(cacheKey, stats, 300);
    
    return stats;
  }

  async refreshDashboardCache() {
    const periods = ['7days', '30days', 'ytd', 'all'];
    for (const period of periods) {
      try {
        const stats = await this.computeDashboardStats(period);
        await this.cacheService.set(`dashboard:stats:${period}`, stats, 600); // 10 minutes cache
      } catch (error) {
        // Only log if it's not a connection issue (already handled by CacheService)
      }
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
      startDate = new Date(2020, 0, 1); // System inception
      prevStartDate = new Date(2020, 0, 1);
    } else {
      // default 30days
      startDate.setDate(now.getDate() - 30);
      prevStartDate.setDate(now.getDate() - 60);
    }

    // KPIs
    const totalOrders = await this.orderRepository.count({ where: { createdAt: MoreThanOrEqual(startDate) } });
    const prevOrders = await this.orderRepository.count({ where: { createdAt: Between(prevStartDate, startDate) } });

    const revenueResult = await this.orderRepository.createQueryBuilder('order')
      .select('SUM(order.amount)', 'total')
      .where('order.status = :status', { status: OrderStatus.COMPLETED })
      .andWhere('order.createdAt >= :startDate', { startDate })
      .getRawOne();
    
    const prevRevenueResult = await this.orderRepository.createQueryBuilder('order')
      .select('SUM(order.amount)', 'total')
      .where('order.status = :status', { status: OrderStatus.COMPLETED })
      .andWhere('order.createdAt BETWEEN :prevStart AND :startDate', { prevStart: prevStartDate, startDate })
      .getRawOne();

    const totalCustomers = await this.customerRepository.count({ where: { createdAt: MoreThanOrEqual(startDate) } });
    const prevCustomers = await this.customerRepository.count({ where: { createdAt: Between(prevStartDate, startDate) } });

    const totalLeads = await this.leadRepository.count({ where: { createdAt: MoreThanOrEqual(startDate) } });
    const prevLeads = await this.leadRepository.count({ where: { createdAt: Between(prevStartDate, startDate) } });

    // Recent Orders (5)
    const recentOrders = await this.orderRepository.find({
      relations: ['customer'],
      order: { createdAt: 'DESC' },
      take: 5
    });

    // Revenue by Month (Last 12)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(now.getMonth() - 11);
    twelveMonthsAgo.setDate(1);

    const revenueByMonth = await this.orderRepository.createQueryBuilder('order')
      .select("DATE_FORMAT(order.createdAt, '%Y-%m')", 'month')
      .addSelect('SUM(order.amount)', 'revenue')
      .where('order.status = :status', { status: OrderStatus.COMPLETED })
      .andWhere('order.createdAt >= :twelveMonthsAgo', { twelveMonthsAgo })
      .groupBy('month')
      .orderBy('month', 'ASC')
      .getRawMany();

    // Top Agents
    const topAgents = await this.orderRepository.createQueryBuilder('order')
      .leftJoin('order.closerAgent', 'agent')
      .select('agent.name', 'name')
      .addSelect('SUM(order.amount)', 'totalRevenue')
      .addSelect('COUNT(order.id)', 'orderCount')
      .where('order.status = :status', { status: OrderStatus.COMPLETED })
      .andWhere('order.createdAt >= :startDate', { startDate })
      .groupBy('agent.id')
      .orderBy('totalRevenue', 'DESC')
      .limit(5)
      .getRawMany();

    // Distribution
    const ordersByType = await this.orderRepository.createQueryBuilder('order')
      .select('order.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .andWhere('order.createdAt >= :startDate', { startDate })
      .groupBy('order.type')
      .getRawMany();
    
    const leadsFunnel = await this.leadRepository.createQueryBuilder('lead')
      .select('lead.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .andWhere('lead.createdAt >= :startDate', { startDate })
      .groupBy('lead.status')
      .getRawMany();

    // Top States (New)
    const topStates = await this.orderRepository.createQueryBuilder('order')
      .leftJoin('order.customer', 'customer')
      .select('customer.state', 'name')
      .addSelect('COUNT(order.id)', 'count')
      .where('order.createdAt >= :startDate', { startDate })
      .groupBy('customer.state')
      .orderBy('count', 'DESC')
      .limit(5)
      .getRawMany();

    return {
      kpis: {
        totalOrders,
        prevOrders,
        totalRevenue: parseFloat(revenueResult.total || 0),
        prevRevenue: parseFloat(prevRevenueResult.total || 0),
        totalCustomers,
        prevCustomers,
        totalLeads,
        prevLeads
      },
      recentOrders: recentOrders.map(o => ({
        id: o.id,
        customerName: o.customer.name,
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
        count: parseInt(s.count)
      }))
    };
  }

  async sendInvoiceToCustomerEmail(orderId: number) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['customer', 'devices', 'leadAgent', 'closerAgent'],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!order.customer.email) {
      throw new BadRequestException('Customer does not have an email address');
    }

    const pdfBuffer = await this.invoicePdfService.generateInvoiceBuffer(order);

    const subject = `Invoice for Order #${order.id} - EN TEC`;
    const text = `Dear ${order.customer.name},\n\nPlease find attached the invoice for your order #${order.id}.\n\nThank you for your business!`;

    await this.emailService.sendMail(order.customer.email, subject, text, [
      {
        filename: `Invoice-INV-${order.id}.pdf`,
        content: pdfBuffer,
      },
    ]);

    return { success: true, email: order.customer.email };
  }
}
