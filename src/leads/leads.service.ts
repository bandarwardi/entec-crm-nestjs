import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument } from './schemas/lead.schema';
import { CreateLeadDto, UpdateLeadDto, QueryLeadsDto } from './leads.dto';
import { CacheService } from '../common/cache.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    private readonly cacheService: CacheService,
    private readonly usersService: UsersService,
    private notificationsService: NotificationsService,
  ) { }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkReminders() {
    const now = new Date();
    this.logger.debug(`Cron: Checking for reminders at ${now.toISOString()}`);

    try {
      const pendingReminders = await this.leadModel.find({
        reminderAt: { $lte: now },
        reminderRead: false,
        reminderNotified: false,
      }).exec();

      if (pendingReminders.length > 0) {
        this.logger.log(`Cron: Found ${pendingReminders.length} pending reminders to notify`);
        
        // Find all admins and super-admins
        const allUsers = await this.usersService.findAll();
        const adminIds = allUsers
          .filter(u => u.role === 'admin' || u.role === 'super-admin')
          .map(u => (u as any).id || (u as any)._id.toString());
        
        for (const lead of pendingReminders) {
          try {
            if (!lead.createdBy) {
              this.logger.warn(`Lead ${lead._id} has no creator, skipping notification`);
              continue;
            }

            const creatorId = lead.createdBy.toString();
            
            // Build unique recipient list (creator + admins)
            const recipients = Array.from(new Set([creatorId, ...adminIds]));

            this.logger.log(`Processing reminder for lead ${lead._id}. Total recipients: ${recipients.length}`);

            await this.notificationsService.createBulk(
              recipients,
              'lead_reminder',
              'تذكير بموعد عميل',
              `${lead.name || 'عميل بدون اسم'}: ${lead.reminderNote || 'لا توجد ملاحظات'}`,
              { leadId: lead._id.toString() }
            );

            lead.reminderNotified = true;
            await lead.save();
            this.logger.log(`Reminder notification sent for lead ${lead._id} to ${recipients.length} recipients`);
          } catch (error) {
            this.logger.error(`Failed to process reminder for lead ${lead._id}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Cron job failed: ${error.message}`);
    }
  }

  async findAll(query: QueryLeadsDto, user: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const { search, status, state, hasReminder, createdBy } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (status) filter.status = status;
    if (state) filter.state = state;
    if (hasReminder === 'true') filter.reminderAt = { $ne: null };
    if (hasReminder === 'false') filter.reminderAt = null;

    if (createdBy && (user.role === 'admin' || user.role === 'super-admin')) {
      filter.createdBy = new Types.ObjectId(createdBy);
    }

    console.log('Leads: User making request:', JSON.stringify(user));
    const currentUserId = user.userId || user.id;

    // Restriction for Agents
    if (user.role === 'agent') {
      if (!currentUserId) {
        console.error('Leads Error: Agent userId is missing in request context!');
      } else {
        filter.createdBy = new Types.ObjectId(currentUserId);
        console.log('Leads: Applying agent filter for user:', currentUserId);
      }
    }

    console.log('Leads: Query filter:', JSON.stringify(filter));

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { phone: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    const data = await this.leadModel.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'id name email role')
      .exec();

    const total = await this.leadModel.countDocuments(filter).exec();

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async create(dto: CreateLeadDto, user: any) {
    console.log('Leads: Creating lead for user:', JSON.stringify(user));
    const lead = new this.leadModel({
      ...dto,
      createdBy: new Types.ObjectId(user.userId),
    });
    const saved = await lead.save();
    console.log('Leads: Saved lead with createdBy:', saved.createdBy);
    await this.cacheService.invalidateByPattern('dashboard:stats:*');

    // Populate the creator details before returning to frontend
    return this.leadModel.findById(saved._id).populate('createdBy', 'id name email role').exec();
  }

  async update(id: string, dto: UpdateLeadDto) {
    const updateData: any = { ...dto };
    
    // Reset notification flags if a new reminder is set or updated
    if (dto.reminderAt) {
      updateData.reminderNotified = false;
      updateData.reminderRead = false;
    }

    const lead = await this.leadModel.findByIdAndUpdate(id, updateData, { new: true })
      .populate('createdBy', 'id name email role')
      .exec();
    if (!lead) throw new NotFoundException('العميل المحتمل غير موجود، تعذر التحديث');

    await this.cacheService.invalidateByPattern('dashboard:stats:*');
    return lead;
  }

  async remove(id: string, user: any) {
    const lead = await this.leadModel.findById(id).exec();
    if (!lead) throw new NotFoundException('العميل المحتمل غير موجود، تعذر الحذف');

    if (user.role === 'agent' && lead.createdBy?.toString() !== user.userId) {
      throw new NotFoundException('غير مصرح لك بحذف هذا العميل المحتمل');
    }

    const result = await this.leadModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('العميل المحتمل غير موجود، تعذر الحذف');
    await this.cacheService.invalidateByPattern('dashboard:stats:*');
    return { success: true };
  }

  async bulkCreate(leads: CreateLeadDto[], user: any) {
    const leadsToSave = leads.map(dto => ({
      ...dto,
      createdBy: new Types.ObjectId(user.userId),
    }));
    const saved = await this.leadModel.insertMany(leadsToSave);
    await this.cacheService.invalidateByPattern('dashboard:stats:*');
    return saved;
  }

  async exportAll(user: any) {
    const filter: any = {};
    if (user.role === 'agent') {
      filter.createdBy = new Types.ObjectId(user.userId);
    }

    return this.leadModel.find(filter)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'id name email role')
      .exec();
  }
}
