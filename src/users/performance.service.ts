import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { UserActivity, UserActivityDocument } from './schemas/user-activity.schema';
import { UserStatus } from './user-status.enum';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import { DateTime } from 'luxon';

// Grace period in minutes: allow login up to this many minutes before shift start
const EARLY_LOGIN_GRACE_MINUTES = 5;

@Injectable()
export class PerformanceService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(UserActivity.name)
    private activityModel: Model<UserActivityDocument>,
    private workSettingsService: WorkSettingsService,
  ) { }

  async getMonthlyPerformance(userId: string, year: number, month: number) {
    const user = await this.userModel.findById(userId).select('id name email').exec();
    if (!user) return null;

    const settings = await this.workSettingsService.getSettings();
    const holidays = await this.workSettingsService.getHolidays();
    const timezone = settings.timezone || 'Africa/Cairo';

    const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone: timezone }).startOf('day');
    const monthEnd = monthStart.endOf('month');

    const activities = await this.activityModel.find({
      user: userId,
      timestamp: {
        $gte: monthStart.minus({ days: 1 }).toJSDate(),
        $lte: monthEnd.plus({ days: 1 }).toJSDate(),
      },
    }).sort({ timestamp: 1 }).exec();

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

    for (let day = 1; day <= monthEnd.day; day++) {
      const currentDay = monthStart.set({ day });
      const dayOfWeek = currentDay.weekday; 
      
      const holiday = holidays.find(h => 
        (h.dayOfWeek !== null && h.dayOfWeek === (dayOfWeek % 7)) || 
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

      // Include activities from a few minutes before shift start (early login grace period)
      const earlyWindow = shiftStart.minus({ minutes: EARLY_LOGIN_GRACE_MINUTES });
      const shiftActivities = activities.filter(a => {
        const ts = DateTime.fromJSDate(a.timestamp).setZone(timezone);
        return ts >= earlyWindow && ts <= shiftEnd;
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

      let activeMinutes = 0;
      let busyMinutes = 0;
      let breakMinutes = 0;
      let lateMinutes = 0;

      const firstActivity = shiftActivities[0];
      const firstTs = DateTime.fromJSDate(firstActivity.timestamp).setZone(timezone);
      if (firstActivity.status === UserStatus.ONLINE || firstActivity.status === UserStatus.BUSY || firstActivity.status === UserStatus.BREAK) {
        // If logged in before shift start (early login), treat as on-time
        if (firstTs >= shiftStart && firstTs > shiftStart.plus({ minutes: 5 })) { 
          lateMinutes = Math.floor(firstTs.diff(shiftStart, 'minutes').minutes);
        }
        // If firstTs < shiftStart => early login, lateMinutes stays 0 (on time)
      }

      for (let i = 0; i < shiftActivities.length; i++) {
        const current = shiftActivities[i];
        const next = shiftActivities[i + 1];
        let currentTs = DateTime.fromJSDate(current.timestamp).setZone(timezone);
        const nextTs = next 
          ? DateTime.fromJSDate(next.timestamp).setZone(timezone)
          : shiftEnd; 

        // Clamp early-login timestamps to shift start for duration calculation
        if (currentTs < shiftStart) currentTs = shiftStart;

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

  async getDailyPerformance(userId: string, date: string) {
    const user = await this.userModel.findById(userId).select('id name email').exec();
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

    // Include activities from the early login grace period
    const earlyWindow = shiftStart.minus({ minutes: EARLY_LOGIN_GRACE_MINUTES });
    const activities = await this.activityModel.find({
      user: userId,
      timestamp: {
        $gte: earlyWindow.toJSDate(),
        $lte: shiftEnd.toJSDate(),
      },
    }).sort({ timestamp: 1 }).exec();

    let activeMinutes = 0;
    let busyMinutes = 0;
    let breakMinutes = 0;
    let lateMinutes = 0;

    const detailedActivities = activities.map((activity, index) => {
      let currentTs = DateTime.fromJSDate(activity.timestamp).setZone(timezone);
      const originalTs = currentTs; // Keep original for display
      const next = activities[index + 1];
      const nextTs = next 
        ? DateTime.fromJSDate(next.timestamp).setZone(timezone)
        : shiftEnd;
      
      // Clamp early-login timestamps to shift start for duration calculation
      if (currentTs < shiftStart) currentTs = shiftStart;

      const duration = Math.max(0, Math.floor(nextTs.diff(currentTs, 'minutes').minutes));

      if (activity.status === UserStatus.ONLINE) activeMinutes += duration;
      else if (activity.status === UserStatus.BUSY) busyMinutes += duration;
      else if (activity.status === UserStatus.BREAK) breakMinutes += duration;

      return {
        _id: activity._id,
        user: activity.user,
        status: activity.status,
        breakReason: activity.breakReason,
        notes: activity.notes,
        timestamp: originalTs.toISO(),
        duration,
      };
    });

    if (activities.length > 0) {
      const firstActivity = activities[0];
      const firstTs = DateTime.fromJSDate(firstActivity.timestamp).setZone(timezone);
      if (firstActivity.status === UserStatus.ONLINE || firstActivity.status === UserStatus.BUSY || firstActivity.status === UserStatus.BREAK) {
        // If logged in before shift start (early login), treat as on-time
        if (firstTs >= shiftStart && firstTs > shiftStart.plus({ minutes: 5 })) {
          lateMinutes = Math.floor(firstTs.diff(shiftStart, 'minutes').minutes);
        }
        // If firstTs < shiftStart => early login, lateMinutes stays 0 (on time)
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
