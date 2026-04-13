import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UserActivity } from './user-activity.entity';
import { UsersService } from './users.service';
import { PerformanceService } from './performance.service';
import { AutoLogoutService } from './auto-logout.service';
import { UsersController } from './users.controller';
import { WorkSettingsModule } from '../work-settings/work-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserActivity]),
    WorkSettingsModule,
  ],
  providers: [UsersService, PerformanceService, AutoLogoutService],
  controllers: [UsersController],
  exports: [UsersService, PerformanceService, AutoLogoutService],
})
export class UsersModule {}

