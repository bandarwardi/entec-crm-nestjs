import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UserActivity, UserActivitySchema } from './schemas/user-activity.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { Order, OrderSchema } from '../sales/schemas/order.schema';
import { UsersService } from './users.service';
import { PerformanceService } from './performance.service';
import { AutoLogoutService } from './auto-logout.service';
import { UsersController } from './users.controller';
import { WorkSettingsModule } from '../work-settings/work-settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserActivity.name, schema: UserActivitySchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    WorkSettingsModule,
  ],
  providers: [UsersService, PerformanceService, AutoLogoutService],
  controllers: [UsersController],
  exports: [UsersService, PerformanceService, AutoLogoutService],
})
export class UsersModule {}
