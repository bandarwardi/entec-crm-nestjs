import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { SalesService } from './sales.service';
import { CreateCustomerDto, UpdateCustomerDto, CreateOrderDto, UpdateOrderDto, QueryOrdersDto, QueryCustomersDto, DashboardQueryDto } from './sales.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../users/roles.enum';

@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

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
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async removeOrder(@Param('id') id: string) {
    return this.salesService.removeOrder(id);
  }

  @Post('orders/:id/send-invoice')
  async sendInvoiceEmail(@Param('id') id: string) {
    return this.salesService.sendInvoiceToCustomerEmail(id);
  }

  @Get('geocode')
  async geocode(@Query('address') address: string, @Query('state') state: string) {
    return this.salesService.geocode(address, state);
  }

  @Post('upload-attachment')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
        return cb(null, `${randomName}${extname(file.originalname)}`);
      }
    })
  }))
  async uploadAttachment(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    return { url: `/uploads/${file.filename}` };
  }
}
