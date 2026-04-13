import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkSettings } from './work-settings.entity';
import { Holiday } from './holiday.entity';
import { WorkSettingsService } from './work-settings.service';
import { WorkSettingsController } from './work-settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WorkSettings, Holiday])],
  providers: [WorkSettingsService],
  controllers: [WorkSettingsController],
  exports: [WorkSettingsService],
})
export class WorkSettingsModule {}
