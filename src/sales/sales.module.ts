import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './customer.entity';
import { Order } from './order.entity';
import { OrderDevice } from './order-device.entity';
import { User } from '../users/user.entity';
import { Lead } from '../leads/lead.entity';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { SalesCacheCron } from './sales-cache.cron';
import { InvoicePdfService } from './invoice-pdf.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, Order, OrderDevice, Lead, User]),
    EmailModule,
  ],
  providers: [SalesService, SalesCacheCron, InvoicePdfService],
  controllers: [SalesController],
  exports: [SalesService],
})
export class SalesModule {}
