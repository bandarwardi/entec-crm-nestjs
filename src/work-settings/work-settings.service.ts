import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WorkSettings, WorkSettingsDocument } from './schemas/work-settings.schema';
import { Holiday, HolidayDocument } from './schemas/holiday.schema';

@Injectable()
export class WorkSettingsService implements OnModuleInit {
  constructor(
    @InjectModel(WorkSettings.name)
    private workSettingsModel: Model<WorkSettingsDocument>,
    @InjectModel(Holiday.name)
    private holidayModel: Model<HolidayDocument>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultSettings();
  }

  private async seedDefaultSettings() {
    const settingsCount = await this.workSettingsModel.countDocuments().exec();
    if (settingsCount === 0) {
      const defaultSettings = new this.workSettingsModel({
        shiftStartHour: 22,
        shiftStartMinute: 0,
        shiftEndHour: 6,
        shiftEndMinute: 0,
        breakDurationMinutes: 60,
        deductionRatePerMinute: 0,
        timezone: 'Africa/Cairo',
      });
      await defaultSettings.save();
    }

    const fridayHoliday = await this.holidayModel.findOne({ dayOfWeek: 5 }).exec();
    if (!fridayHoliday) {
      const holiday = new this.holidayModel({
        name: 'الجمعة',
        dayOfWeek: 5,
      });
      await holiday.save();
    }
  }

  async getSettings(): Promise<WorkSettingsDocument> {
    let settings = await this.workSettingsModel.findOne().exec();
    if (!settings) {
      settings = await new this.workSettingsModel({}).save();
    }
    return settings;
  }

  async updateSettings(data: Partial<WorkSettings>): Promise<WorkSettingsDocument> {
    const settings = await this.getSettings();
    Object.assign(settings, data);
    return settings.save();
  }

  async getHolidays(): Promise<HolidayDocument[]> {
    return this.holidayModel.find().exec();
  }

  async addHoliday(data: Partial<Holiday>): Promise<HolidayDocument> {
    const holiday = new this.holidayModel(data);
    return holiday.save();
  }

  async deleteHoliday(id: string): Promise<void> {
    await this.holidayModel.findByIdAndDelete(id).exec();
  }
}
