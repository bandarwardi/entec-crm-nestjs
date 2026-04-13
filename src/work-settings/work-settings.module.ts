import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkSettings, WorkSettingsSchema } from './schemas/work-settings.schema';
import { Holiday, HolidaySchema } from './schemas/holiday.schema';
import { WorkSettingsService } from './work-settings.service';
import { WorkSettingsController } from './work-settings.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkSettings.name, schema: WorkSettingsSchema },
      { name: Holiday.name, schema: HolidaySchema },
    ]),
  ],
  providers: [WorkSettingsService],
  controllers: [WorkSettingsController],
  exports: [WorkSettingsService],
})
export class WorkSettingsModule {}
