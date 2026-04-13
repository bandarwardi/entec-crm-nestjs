import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UserActivity, UserActivitySchema } from './schemas/user-activity.schema';
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
    ]),
    WorkSettingsModule,
  ],
  providers: [UsersService, PerformanceService, AutoLogoutService],
  controllers: [UsersController],
  exports: [UsersService, PerformanceService, AutoLogoutService],
})
export class UsersModule {}
