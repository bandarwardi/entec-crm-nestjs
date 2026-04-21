import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SalesService } from './sales.service';
import { CreateCustomerDto, UpdateCustomerDto, CreateOrderDto, UpdateOrderDto, QueryOrdersDto, QueryCustomersDto, DashboardQueryDto } from './sales.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../users/roles.enum';
import { UploadProxyService } from '../common/upload-proxy.service';

@Controller('sales')
// @UseGuards(JwtAuthGuard, RolesGuard)
// @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT)
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly uploadProxy: UploadProxyService,
  ) {}

  @Get('export/excel')
  async exportExcel(@Res() res) {
    console.log('[SalesController] Exporting Excel...');
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
  async updateInvoiceSettings(@Body() dto: any) {
    return this.salesService.updateInvoiceSettings(dto);
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
  async createCustomer(@Body() dto: CreateCustomerDto) {
    return this.salesService.createCustomer(dto);
  }

  @Put('customers/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async updateCustomer(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.salesService.updateCustomer(id, dto);
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
  async createOrder(@Body() dto: CreateOrderDto) {
    return this.salesService.createOrder(dto);
  }

  @Put('orders/:id')
  async updateOrder(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.salesService.updateOrder(id, dto);
  }

  @Delete('orders/:id')
  @Roles(Role.SUPER_ADMIN)
  async removeOrder(@Param('id') id: string) {
    return this.salesService.removeOrder(id);
  }

  @Delete('customers/:id')
  @Roles(Role.SUPER_ADMIN)
  async removeCustomer(@Param('id') id: string) {
    return this.salesService.removeCustomer(id);
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

}
