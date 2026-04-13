import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, MoreThanOrEqual, LessThanOrEqual, IsNull, Not } from 'typeorm';
import { CacheService } from '../common/cache.service';
import { Lead } from './lead.entity';
import { CreateLeadDto, UpdateLeadDto, QueryLeadsDto } from './leads.dto';
import { User } from '../users/user.entity';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepository: Repository<Lead>,
    private readonly cacheService: CacheService,
  ) { }

  async findAll(query: QueryLeadsDto, user: any) {
    const { page = 1, limit = 20, search, status, state, hasReminder } = query;
    const skip = (page - 1) * limit;

    const baseWhere: any = {};
    if (status) baseWhere.status = status;
    if (state) baseWhere.state = state;
    if (hasReminder === 'true') baseWhere.reminderAt = Not(IsNull());
    if (hasReminder === 'false') baseWhere.reminderAt = IsNull();

    // Restriction for Agents
    if (user.role === 'agent') {
      baseWhere.createdBy = { id: user.userId };
    }

    let finalWhere: any = baseWhere;
    if (search) {
      finalWhere = [
        { ...baseWhere, name: Like(`%${search}%`) },
        { ...baseWhere, phone: Like(`%${search}%`) }
      ];
    }

    const [data, total] = await this.leadsRepository.findAndCount({
      where: finalWhere,
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
      relations: ['createdBy'],
    });

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async create(dto: CreateLeadDto, user: any) {
    const lead = this.leadsRepository.create({
      ...dto,
      createdBy: { id: user.userId } as any,
    });
    const saved = await this.leadsRepository.save(lead);
    await this.cacheService.invalidateByPattern('dashboard:stats:*');
    return saved;
  }

  async update(id: number, dto: UpdateLeadDto) {
    const lead = await this.leadsRepository.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('العميل المحتمل غير موجود، تعذر التحديث');

    Object.assign(lead, dto);
    const saved = await this.leadsRepository.save(lead);
    await this.cacheService.invalidateByPattern('dashboard:stats:*');
    return saved;
  }

  async remove(id: number) {
    const result = await this.leadsRepository.delete(id);
    if (result.affected === 0) throw new NotFoundException('العميل المحتمل غير موجود، تعذر الحذف');
    await this.cacheService.invalidateByPattern('dashboard:stats:*');
    return { success: true };
  }

  async getPendingReminders(userId: number) {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    return this.leadsRepository.find({
      where: {
        createdBy: { id: userId },
        reminderRead: false,
        reminderAt: MoreThanOrEqual(oneHourAgo) as any,
      },
      order: { reminderAt: 'ASC' },
    }).then(leads => leads.filter(l => l.reminderAt <= oneHourFromNow));
  }

  async markRemindersAsRead(userId: number) {
    const reminders = await this.getPendingReminders(userId);
    if (reminders.length > 0) {
      await this.leadsRepository.update(
        reminders.map(r => r.id),
        { reminderRead: true }
      );
    }
    return { success: true };
  }

  async getAllReminders(userId: number, query: { page?: number, limit?: number }) {
    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await this.leadsRepository.findAndCount({
      where: {
        createdBy: { id: userId },
        reminderAt: MoreThanOrEqual(new Date('2000-01-01')) as any, // Not null basically
      },
      order: { reminderAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async bulkCreate(leads: CreateLeadDto[], user: any) {
    const leadsToSave = leads.map(dto => this.leadsRepository.create({
      ...dto,
      createdBy: { id: user.userId } as any,
    }));
    const saved = await this.leadsRepository.save(leadsToSave);
    await this.cacheService.invalidateByPattern('dashboard:stats:*');
    return saved;
  }

  async exportAll(user: any) {
    const where: any = {};
    if (user.role === 'agent') {
      where.createdBy = { id: user.userId };
    }

    return this.leadsRepository.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['createdBy'],
    });
  }
}
