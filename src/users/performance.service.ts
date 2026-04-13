import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { User } from './user.entity';
import { UserActivity } from './user-activity.entity';
import { UserStatus } from './user-status.enum';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import { DateTime, Interval } from 'luxon';

@Injectable()
export class PerformanceService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(UserActivity)
    private activitiesRepository: Repository<UserActivity>,
    private workSettingsService: WorkSettingsService,
  ) { }

  async getMonthlyPerformance(userId: number, year: number, month: number) {
    const user = await this.usersRepository.findOne({ where: { id: userId }, select: ['id', 'name', 'email'] });
    if (!user) return null;

    const settings = await this.workSettingsService.getSettings();
    const holidays = await this.workSettingsService.getHolidays();
    const timezone = settings.timezone || 'Africa/Cairo';

    // Get start and end of the month in Cairo timezone
    const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone: timezone }).startOf('day');
    const monthEnd = monthStart.endOf('month');

    // Fetch all activities for the user in this month (plus a buffer for the overnight shift)
    // Shift can start on the last day of the previous month or end on the first day of the next month.
    // To be safe, we fetch from monthStart.minus({ days: 1 }) to monthEnd.plus({ days: 1 })
    const activities = await this.activitiesRepository.find({
      where: {
        user: { id: userId },
        timestamp: Between(
          monthStart.minus({ days: 1 }).toJSDate(),
          monthEnd.plus({ days: 1 }).toJSDate(),
        ),
      },
      order: { timestamp: 'ASC' },
    });

    const days: any[] = [];
    let totals = {
      totalActiveMinutes: 0,
      totalBusyMinutes: 0,
      totalBreakMinutes: 0,
      totalLateMinutes: 0,
      totalExcessBreakMinutes: 0,
      totalDeductionAmount: 0,
      workingDays: 0,
      holidaysCount: 0,
    };

    // Iterate through each day of the month
    for (let day = 1; day <= monthEnd.day; day++) {
      const currentDay = monthStart.set({ day });
      const dayOfWeek = currentDay.weekday; // 1=Mon, 7=Sun (Luxon) -> Friday is 5.
      
      const holiday = holidays.find(h => 
        (h.dayOfWeek !== null && h.dayOfWeek === (dayOfWeek % 7)) || // Adjusting for 0=Sun in DB if needed, Luxon uses 1=Mon
        (h.specificDate && DateTime.fromISO(h.specificDate).hasSame(currentDay, 'day'))
      );

      if (holiday) {
        days.push({
          date: currentDay.toISODate(),
          dayOfWeek: currentDay.weekdayLong,
          isHoliday: true,
          holidayName: holiday.name,
        });
        totals.holidaysCount++;
        continue;
      }

      // Calculate shift start and end for this day
      // Shift starts at 10 PM of currentDay and ends at 6 AM of nextDay
      const shiftStart = currentDay.set({
        hour: settings.shiftStartHour,
        minute: settings.shiftStartMinute,
        second: 0,
        millisecond: 0,
      });
      const shiftEnd = shiftStart.plus({
        hours: (settings.shiftEndHour < settings.shiftStartHour) 
          ? (24 - settings.shiftStartHour + settings.shiftEndHour)
          : (settings.shiftEndHour - settings.shiftStartHour),
        minutes: settings.shiftEndMinute - settings.shiftStartMinute
      });

      // Filter activities for this shift
      const shiftActivities = activities.filter(a => {
        const ts = DateTime.fromJSDate(a.timestamp).setZone(timezone);
        return ts >= shiftStart && ts <= shiftEnd;
      });

      if (shiftActivities.length === 0) {
        days.push({
          date: currentDay.toISODate(),
          dayOfWeek: currentDay.weekdayLong,
          isHoliday: false,
          hasData: false,
        });
        totals.workingDays++;
        continue;
      }

      // Calculate durations
      let activeMinutes = 0;
      let busyMinutes = 0;
      let breakMinutes = 0;
      let lateMinutes = 0;

      // Late calculation: if first activity is after shiftStart
      const firstActivity = shiftActivities[0];
      const firstTs = DateTime.fromJSDate(firstActivity.timestamp).setZone(timezone);
      if (firstActivity.status === UserStatus.ONLINE || firstActivity.status === UserStatus.BUSY || firstActivity.status === UserStatus.BREAK) {
        if (firstTs > shiftStart.plus({ minutes: 5 })) { // 5 mins grace period maybe? No, let's be strict or as requested
          lateMinutes = Math.floor(firstTs.diff(shiftStart, 'minutes').minutes);
        }
      }

      for (let i = 0; i < shiftActivities.length; i++) {
        const current = shiftActivities[i];
        const next = shiftActivities[i + 1];
        const currentTs = DateTime.fromJSDate(current.timestamp).setZone(timezone);
        const nextTs = next 
          ? DateTime.fromJSDate(next.timestamp).setZone(timezone)
          : shiftEnd; // Use shiftEnd if it's the last activity

        const duration = Math.max(0, Math.floor(nextTs.diff(currentTs, 'minutes').minutes));

        if (current.status === UserStatus.ONLINE) activeMinutes += duration;
        else if (current.status === UserStatus.BUSY) busyMinutes += duration;
        else if (current.status === UserStatus.BREAK) breakMinutes += duration;
      }

      const excessBreakMinutes = Math.max(0, breakMinutes - settings.breakDurationMinutes);
      const deductionAmount = (lateMinutes + excessBreakMinutes) * Number(settings.deductionRatePerMinute);

      days.push({
        date: currentDay.toISODate(),
        dayOfWeek: currentDay.weekdayLong,
        isHoliday: false,
        hasData: true,
        activeMinutes,
        busyMinutes,
        breakMinutes,
        lateMinutes,
        excessBreakMinutes,
        deductionAmount,
        firstLogin: firstTs.toISO(),
      });

      totals.totalActiveMinutes += activeMinutes;
      totals.totalBusyMinutes += busyMinutes;
      totals.totalBreakMinutes += breakMinutes;
      totals.totalLateMinutes += lateMinutes;
      totals.totalExcessBreakMinutes += excessBreakMinutes;
      totals.totalDeductionAmount += deductionAmount;
      totals.workingDays++;
    }

    return {
      user,
      year,
      month,
      workSettings: settings,
      days,
      totals,
    };
  }

  async getDailyPerformance(userId: number, date: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId }, select: ['id', 'name', 'email'] });
    if (!user) return null;

    const settings = await this.workSettingsService.getSettings();
    const timezone = settings.timezone || 'Africa/Cairo';

    const currentDay = DateTime.fromISO(date, { zone: timezone }).startOf('day');
    const shiftStart = currentDay.set({
      hour: settings.shiftStartHour,
      minute: settings.shiftStartMinute,
      second: 0,
      millisecond: 0,
    });
    const shiftEnd = shiftStart.plus({
      hours: (settings.shiftEndHour < settings.shiftStartHour) 
        ? (24 - settings.shiftStartHour + settings.shiftEndHour)
        : (settings.shiftEndHour - settings.shiftStartHour),
      minutes: settings.shiftEndMinute - settings.shiftStartMinute
    });

    const activities = await this.activitiesRepository.find({
      where: {
        user: { id: userId },
        timestamp: Between(shiftStart.toJSDate(), shiftEnd.toJSDate()),
      },
      order: { timestamp: 'ASC' },
    });

    let activeMinutes = 0;
    let busyMinutes = 0;
    let breakMinutes = 0;
    let lateMinutes = 0;

    const detailedActivities = activities.map((activity, index) => {
      const currentTs = DateTime.fromJSDate(activity.timestamp).setZone(timezone);
      const next = activities[index + 1];
      const nextTs = next 
        ? DateTime.fromJSDate(next.timestamp).setZone(timezone)
        : shiftEnd;
      
      const duration = Math.max(0, Math.floor(nextTs.diff(currentTs, 'minutes').minutes));

      if (activity.status === UserStatus.ONLINE) activeMinutes += duration;
      else if (activity.status === UserStatus.BUSY) busyMinutes += duration;
      else if (activity.status === UserStatus.BREAK) breakMinutes += duration;

      return {
        ...activity,
        timestamp: currentTs.toISO(),
        duration,
      };
    });

    // Late calculation
    if (activities.length > 0) {
      const firstActivity = activities[0];
      const firstTs = DateTime.fromJSDate(firstActivity.timestamp).setZone(timezone);
      if (firstActivity.status === UserStatus.ONLINE || firstActivity.status === UserStatus.BUSY || firstActivity.status === UserStatus.BREAK) {
        if (firstTs > shiftStart.plus({ minutes: 5 })) {
          lateMinutes = Math.floor(firstTs.diff(shiftStart, 'minutes').minutes);
        }
      }
    }

    const excessBreakMinutes = Math.max(0, breakMinutes - settings.breakDurationMinutes);
    const deductionAmount = (lateMinutes + excessBreakMinutes) * Number(settings.deductionRatePerMinute);

    return {
      user,
      date,
      shiftStart: shiftStart.toISO(),
      shiftEnd: shiftEnd.toISO(),
      activities: detailedActivities,
      totals: {
        activeMinutes,
        busyMinutes,
        breakMinutes,
        lateMinutes,
        excessBreakMinutes,
        deductionAmount,
      }
    };
  }
}
