import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SalesService } from './sales.service';
import { CreateCustomerDto, UpdateCustomerDto, CreateOrderDto, UpdateOrderDto, QueryOrdersDto, QueryCustomersDto, DashboardQueryDto } from './sales.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../users/roles.enum';
import { UploadProxyService } from '../common/upload-proxy.service';

import { AuditLogService } from '../audit-log/audit-log.service';
import { Request as NestRequest } from '@nestjs/common';

@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard, SessionGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT)
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly uploadProxy: UploadProxyService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get('excel-export')
  async exportExcel(@Res() res) {
    console.log('[SalesController] CRITICAL: Calling Excel Export Endpoint');
    const buffer = await this.salesService.exportOrdersToExcel();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=Sales-Export.xlsx',
      'Content-Length': (buffer as any).length,
    });
    res.end(buffer);
  }

  @Post('import/excel')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    console.log('[SalesController] Importing Excel...');
    if (!file) throw new BadRequestException('يجب رفع ملف إكسيل');
    return this.salesService.importOrdersFromExcel(file.buffer);
  }

  // --- Invoice Settings ---
  @Get('invoice-settings')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getInvoiceSettings() {
    return this.salesService.getInvoiceSettings();
  }

  @Put('invoice-settings')
  @Roles(Role.SUPER_ADMIN)
  async updateInvoiceSettings(@Body() dto: any, @NestRequest() req: any) {
    const result = await this.salesService.updateInvoiceSettings(dto);
    await this.auditLogService.log({
      user: req.user.id,
      action: 'UPDATE_INVOICE_SETTINGS',
      resource: 'Settings',
      metadata: dto,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    return result;
  }

  // --- Customers ---
  @Get('customers')
  async findAllCustomers(@Query() query: QueryCustomersDto) {
    return this.salesService.findAllCustomers(query);
  }

  @Get('customers/:id')
  async findOneCustomer(@Param('id') id: string) {
    return this.salesService.findOneCustomer(id);
  }

  @Post('customers')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async createCustomer(@Body() dto: CreateCustomerDto, @NestRequest() req: any) {
    const customer = await this.salesService.createCustomer(dto);
    await this.auditLogService.log({
      user: req.user.id,
      action: 'CREATE_CUSTOMER',
      resource: 'Customer',
      resourceId: customer.id,
      metadata: { name: dto.name, phone: dto.phone },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    return customer;
  }

  @Put('customers/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async updateCustomer(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @NestRequest() req: any) {
    const customer = await this.salesService.updateCustomer(id, dto);
    await this.auditLogService.log({
      user: req.user.id,
      action: 'UPDATE_CUSTOMER',
      resource: 'Customer',
      resourceId: id,
      metadata: dto,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    return customer;
  }

  // --- Orders ---
  @Get('orders')
  async findAllOrders(@Query() query: QueryOrdersDto) {
    return this.salesService.findAllOrders(query);
  }

  @Get('dashboard')
  async getDashboardStats(@Query() query: DashboardQueryDto) {
    return this.salesService.getDashboardStats(query);
  }

  @Get('orders/:id')
  async findOneOrder(@Param('id') id: string) {
    return this.salesService.findOneOrder(id);
  }

  @Post('orders')
  async createOrder(@Body() dto: CreateOrderDto, @NestRequest() req: any) {
    const order = await this.salesService.createOrder(dto);
    await this.auditLogService.log({
      user: req.user.id,
      action: 'CREATE_ORDER',
      resource: 'Order',
      resourceId: order.id,
      metadata: { amount: dto.amount, customerId: dto.customerId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    return order;
  }

  @Put('orders/:id')
  async updateOrder(@Param('id') id: string, @Body() dto: UpdateOrderDto, @NestRequest() req: any) {
    const order = await this.salesService.updateOrder(id, dto);
    await this.auditLogService.log({
      user: req.user.id,
      action: 'UPDATE_ORDER',
      resource: 'Order',
      resourceId: id,
      metadata: dto,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    return order;
  }

  @Delete('orders/:id')
  @Roles(Role.SUPER_ADMIN)
  async removeOrder(@Param('id') id: string, @NestRequest() req: any) {
    const result = await this.salesService.removeOrder(id);
    await this.auditLogService.log({
      user: req.user.id,
      action: 'DELETE_ORDER',
      resource: 'Order',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    return result;
  }

  @Delete('customers/:id')
  @Roles(Role.SUPER_ADMIN)
  async removeCustomer(@Param('id') id: string, @NestRequest() req: any) {
    const result = await this.salesService.removeCustomer(id);
    await this.auditLogService.log({
      user: req.user.id,
      action: 'DELETE_CUSTOMER',
      resource: 'Customer',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    return result;
  }

  @Post('customers/geocode-all')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async geocodeAllCustomers() {
    return this.salesService.geocodeAllCustomers();
  }

  @Post('orders/:id/send-invoice')
  async sendInvoiceEmail(@Param('id') id: string) {
    return this.salesService.sendInvoiceToCustomerEmail(id);
  }

  @Get('geocode')
  async geocode(@Query('address') address: string, @Query('state') state: string, @Query('country') country: string) {
    return this.salesService.geocode(address, state, country);
  }

  @Post('upload-attachment')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadAttachment(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = await this.uploadProxy.uploadFile(file);
    return { url };
  }

  @Get('commissions')
  async getCommissions(
    @Query('month') month: number,
    @Query('year') year: number,
    @Query('agentId') agentId: string,
    @NestRequest() req
  ) {
    const targetAgentId = agentId || req.user.id;
    
    // Security: Agents can only see their own commissions
    if (req.user.role === Role.AGENT && targetAgentId !== req.user.id) {
      throw new BadRequestException('غير مسموح لك بعرض عمولات موظف آخر');
    }

    return this.salesService.getAgentCommissions(targetAgentId, month, year);
  }

}
