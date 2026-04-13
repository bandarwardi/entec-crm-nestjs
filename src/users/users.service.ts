import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { User } from './user.entity';
import { UserActivity } from './user-activity.entity';
import { UserStatus, BreakReason } from './user-status.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(UserActivity)
    private activitiesRepository: Repository<UserActivity>,
  ) { }

  async updateStatus(userId: number, status: UserStatus, breakReason?: BreakReason, notes?: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) return null;

    // Log the activity
    const activity = this.activitiesRepository.create({
      user,
      status,
      breakReason,
      notes,
    });
    await this.activitiesRepository.save(activity);

    // Update user current status
    user.currentStatus = status;
    user.lastStatusChange = new Date();
    return this.usersRepository.save(user);
  }

  async getUserActivities(userId: number, limit: number = 50) {
    return this.activitiesRepository.find({
      where: { user: { id: userId } },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async getAllUserActivities(limit: number = 100) {
    return this.activitiesRepository.find({
      relations: ['user'],
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async findOneByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async create(userData: Partial<User>): Promise<User> {
    const user = this.usersRepository.create(userData);
    return this.usersRepository.save(user);
  }

  async findAll(search?: string): Promise<User[]> {
    const where = search ? [
      { name: Like(`%${search}%`) },
      { email: Like(`%${search}%`) }
    ] : {};

    return this.usersRepository.find({ 
      where,
      select: ['id', 'name', 'email', 'role', 'avatar', 'currentStatus', 'createdAt'] 
    });
  }

  async findOne(id: number): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id }, select: ['id', 'name', 'email', 'role', 'avatar', 'currentStatus', 'createdAt'] });
  }

  async update(id: number, updateData: Partial<User>): Promise<User | null> {
    await this.usersRepository.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.usersRepository.delete(id);
  }
}
