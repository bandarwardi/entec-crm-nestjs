import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkSettings } from './work-settings.entity';
import { Holiday } from './holiday.entity';

@Injectable()
export class WorkSettingsService implements OnModuleInit {
  constructor(
    @InjectRepository(WorkSettings)
    private workSettingsRepository: Repository<WorkSettings>,
    @InjectRepository(Holiday)
    private holidayRepository: Repository<Holiday>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultSettings();
  }

  private async seedDefaultSettings() {
    const settingsCount = await this.workSettingsRepository.count();
    if (settingsCount === 0) {
      const defaultSettings = this.workSettingsRepository.create({
        shiftStartHour: 22,
        shiftStartMinute: 0,
        shiftEndHour: 6,
        shiftEndMinute: 0,
        breakDurationMinutes: 60,
        deductionRatePerMinute: 0,
        timezone: 'Africa/Cairo',
      });
      await this.workSettingsRepository.save(defaultSettings);
    }

    const fridayHoliday = await this.holidayRepository.findOne({ where: { dayOfWeek: 5 } });
    if (!fridayHoliday) {
      const holiday = this.holidayRepository.create({
        name: 'الجمعة',
        dayOfWeek: 5,
      });
      await this.holidayRepository.save(holiday);
    }
  }

  async getSettings(): Promise<WorkSettings> {
    let settings = await this.workSettingsRepository.findOne({ where: {} });
    if (!settings) {
      settings = await this.workSettingsRepository.save(this.workSettingsRepository.create({}));
    }
    return settings;
  }

  async updateSettings(data: Partial<WorkSettings>): Promise<WorkSettings> {
    const settings = await this.getSettings();
    Object.assign(settings, data);
    return this.workSettingsRepository.save(settings);
  }

  async getHolidays(): Promise<Holiday[]> {
    return this.holidayRepository.find();
  }

  async addHoliday(data: Partial<Holiday>): Promise<Holiday> {
    const holiday = this.holidayRepository.create(data);
    return this.holidayRepository.save(holiday);
  }

  async deleteHoliday(id: number): Promise<void> {
    await this.holidayRepository.delete(id);
  }
}
