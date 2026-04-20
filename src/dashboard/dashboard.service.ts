import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UserActivity, UserActivityDocument } from '../users/schemas/user-activity.schema';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { UserStatus } from '../users/user-status.enum';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import { DateTime } from 'luxon';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(UserActivity.name) private activityModel: Model<UserActivityDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    private workSettingsService: WorkSettingsService,
  ) {}

  async getTodayAdminStats(date?: string) {
    const settings = await this.workSettingsService.getSettings();
    const timezone = settings.timezone || 'Africa/Cairo';
    const targetDate = date ? DateTime.fromISO(date).setZone(timezone) : DateTime.now().setZone(timezone);
    const startOfDay = targetDate.startOf('day');
    const endOfDay = targetDate.endOf('day');

    // 1. Get total leads for the period
    const todayLeadsCount = await this.leadModel.countDocuments({
      createdAt: { $gte: startOfDay.toJSDate(), $lte: endOfDay.toJSDate() }
    });

    // 2. Get all agents
    const agents = await this.userModel.find({ role: 'agent' }).select('id name currentStatus').exec();

    // 3. Calculate performance for each agent for the period
    const employeePerformance = await Promise.all(agents.map(async (agent) => {
      const perf = await this.calculateDailyPerformance(agent._id.toString(), startOfDay, settings);
      
      // Get leads added by this agent on this specific day
      const leadsCount = await this.leadModel.countDocuments({
        creator: agent._id,
        createdAt: { $gte: startOfDay.toJSDate(), $lte: endOfDay.toJSDate() }
      });

      return {
        id: agent._id,
        name: agent.name,
        status: agent.currentStatus,
        leadsCount,
        ...perf
      };
    }));

    return {
      todayLeadsCount,
      employeePerformance
    };
  }

  private async calculateDailyPerformance(userId: string, day: DateTime, settings: any) {
    const timezone = settings.timezone || 'Africa/Cairo';
    const shiftStart = day.set({
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

    const activities = await this.activityModel.find({
      user: new Types.ObjectId(userId),
      timestamp: {
        $gte: shiftStart.minus({ minutes: 30 }).toJSDate(), // Buffer for early login
        $lte: shiftEnd.toJSDate(),
      },
    }).sort({ timestamp: 1 }).exec();

    if (activities.length === 0) {
      return {
        firstLogin: null,
        lateMinutes: 0,
        breakMinutes: 0,
        deductionAmount: 0,
        isOnline: false
      };
    }

    let breakMinutes = 0;
    let lateMinutes = 0;
    const firstActivity = activities[0];
    const firstTs = DateTime.fromJSDate(firstActivity.timestamp).setZone(timezone);

    if ([UserStatus.ONLINE, UserStatus.BUSY, UserStatus.BREAK].includes(firstActivity.status as any)) {
      if (firstTs > shiftStart.plus({ minutes: 5 })) {
        lateMinutes = Math.floor(firstTs.diff(shiftStart, 'minutes').minutes);
      }
    }

    for (let i = 0; i < activities.length; i++) {
      const current = activities[i];
      const next = activities[i + 1];
      let currentTs = DateTime.fromJSDate(current.timestamp).setZone(timezone);
      const nextTs = next 
        ? DateTime.fromJSDate(next.timestamp).setZone(timezone)
        : (DateTime.now().setZone(timezone) < shiftEnd ? DateTime.now().setZone(timezone) : shiftEnd);

      if (currentTs < shiftStart) currentTs = shiftStart;
      const duration = Math.max(0, Math.floor(nextTs.diff(currentTs, 'minutes').minutes));

      if (current.status === UserStatus.BREAK) {
        breakMinutes += duration;
      }
    }

    const excessBreakMinutes = Math.max(0, breakMinutes - settings.breakDurationMinutes);
    const deductionAmount = (lateMinutes + excessBreakMinutes) * Number(settings.deductionRatePerMinute);

    return {
      firstLogin: firstTs.toISO(),
      lateMinutes,
      breakMinutes,
      deductionAmount,
    };
  }
}
