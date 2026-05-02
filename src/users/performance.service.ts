import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { UserActivity, UserActivityDocument } from './schemas/user-activity.schema';
import { UserStatus } from './user-status.enum';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import { DateTime } from 'luxon';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { Order, OrderDocument } from '../sales/schemas/order.schema';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Grace period in minutes: allow login up to this many minutes before shift start
const EARLY_LOGIN_GRACE_MINUTES = 5;

@Injectable()
export class PerformanceService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(UserActivity.name)
    private activityModel: Model<UserActivityDocument>,
    @InjectModel(Lead.name)
    private leadModel: Model<LeadDocument>,
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,
    private workSettingsService: WorkSettingsService,
    private configService: ConfigService,
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

  async getAiPerformanceReport(userId: string, year: number, month: number): Promise<{ report: string }> {
    const monthlyData = await this.getMonthlyPerformance(userId, year, month);
    if (!monthlyData) {
      throw new Error('User not found or no performance data available.');
    }

    const { totals, user } = monthlyData;

    const timezone = monthlyData.workSettings?.timezone || 'Africa/Cairo';
    const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone: timezone }).startOf('day');
    const monthEnd = monthStart.endOf('month');

    // Fetch Leads for this user
    const leadsCount = await this.leadModel.countDocuments({
      createdBy: new Types.ObjectId(userId),
      createdAt: {
        $gte: monthStart.toJSDate(),
        $lte: monthEnd.toJSDate(),
      },
    }).exec();

    // Fetch Sales for this user (leadAgent or closerAgent)
    const sales = await this.orderModel.find({
      $or: [{ leadAgent: userId }, { closerAgent: userId }],
      createdAt: {
        $gte: monthStart.toJSDate(),
        $lte: monthEnd.toJSDate(),
      },
      status: 'completed' // Assuming we only count completed orders
    }).exec();

    const salesCount = sales.length;
    const totalSalesAmount = sales.reduce((sum, order) => sum + (order.amount || 0), 0);

    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); // Using the available 2.5 flash model

    const hoursActive = Math.floor(totals.totalActiveMinutes / 60);
    const minutesActive = totals.totalActiveMinutes % 60;
    const lateMinutes = totals.totalLateMinutes;
    const deduction = totals.totalDeductionAmount;
    
    const prompt = `أنت خبير موارد بشرية وتقييم أداء محترف. طلب منك إعداد تقرير تقييم أداء شهري للموظف "${user.name}" لشهر ${month}/${year}.

البيانات الإحصائية لأداء الموظف خلال الشهر:
- إجمالي ساعات العمل الفعلية: ${hoursActive} ساعة و ${minutesActive} دقيقة.
- إجمالي أيام العمل المحتسبة: ${totals.workingDays} يوم.
- إجمالي دقائق التأخير: ${lateMinutes} دقيقة.
- إجمالي الخصومات (بسبب التأخير وتجاوز وقت الراحة): ${deduction} جنيه.
- عدد العملاء المحتملين (Leads) الذين أضافهم الموظف بنفسه: ${leadsCount} عميل.
- إجمالي عدد المبيعات التي أتمها أو شارك فيها: ${salesCount} عملية بيع.
- إجمالي المبالغ المحصلة من هذه المبيعات: ${totalSalesAmount} جنيه.

بناءً على هذه الأرقام، قم بكتابة تقرير شامل واحترافي.
يجب أن يكون الرد بصيغة JSON فقط، بالهيكل التالي (باللغة العربية):
{
  "summary": "مقدمة قصيرة محفزة",
  "discipline_analysis": "تحليل الأداء الانضباطي",
  "productivity_analysis": "تحليل الأداء الإنتاجي والمبيعات",
  "strengths": ["نقطة قوة 1", "نقطة قوة 2"],
  "improvements": ["مجال تحسين 1", "مجال تحسين 2"],
  "final_score": 8.5,
  "recommendation": "توصية مختصرة من سطرين"
}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    try {
      // Clean up JSON response if AI includes markdown code blocks
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (e) {
      // Fallback if AI doesn't return valid JSON
      return { 
        summary: text,
        discipline_analysis: "",
        productivity_analysis: "",
        strengths: [],
        improvements: [],
        final_score: 0,
        recommendation: ""
      } as any;
    }
  }
}
