import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CacheService } from '../common/cache.service';
import { Lead, LeadDocument } from './schemas/lead.schema';
import { CreateLeadDto, UpdateLeadDto, QueryLeadsDto } from './leads.dto';

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    private readonly cacheService: CacheService,
  ) { }

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
    const lead = await this.leadModel.findByIdAndUpdate(id, dto, { new: true }).exec();
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

  async getPendingReminders(userId: string) {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    console.log(`Notifications: Fetching reminders for user ${userId} up to ${oneHourFromNow.toISOString()}`);

    const reminders = await this.leadModel.find({
      createdBy: new Types.ObjectId(userId),
      reminderRead: false,
      reminderAt: {
        $lte: oneHourFromNow
      },
    }).sort({ reminderAt: 1 }).exec();

    console.log(`Notifications: Found ${reminders.length} pending reminders`);
    return reminders;
  }

  async markRemindersAsRead(userId: string) {
    const reminders = await this.getPendingReminders(userId);
    if (reminders.length > 0) {
      await this.leadModel.updateMany(
        { _id: { $in: reminders.map(r => r._id) } },
        { reminderRead: true }
      ).exec();
    }
    return { success: true };
  }

  async getAllReminders(userId: string, query: { page?: number, limit?: number }) {
    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const filter = {
      createdBy: new Types.ObjectId(userId),
      reminderAt: { $ne: null }
    };

    const data = await this.leadModel.find(filter)
      .sort({ reminderAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    const total = await this.leadModel.countDocuments(filter).exec();

    return {
      data,
      total,
      page,
      limit,
    };
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
