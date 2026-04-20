import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UserActivity, UserActivitySchema } from '../users/schemas/user-activity.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { WorkSettingsModule } from '../work-settings/work-settings.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserActivity.name, schema: UserActivitySchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    WorkSettingsModule,
    UsersModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
