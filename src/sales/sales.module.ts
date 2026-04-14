import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { Order, OrderSchema } from './schemas/order.schema';
import { InvoiceSettings, InvoiceSettingsSchema } from './schemas/invoice-settings.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { SalesCacheCron } from './sales-cache.cron';
import { InvoicePdfService } from './invoice-pdf.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Order.name, schema: OrderSchema },
      { name: InvoiceSettings.name, schema: InvoiceSettingsSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EmailModule,
  ],
  providers: [SalesService, SalesCacheCron, InvoicePdfService],
  controllers: [SalesController],
  exports: [SalesService],
})
export class SalesModule {}
