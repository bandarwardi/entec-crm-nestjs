import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { UserActivity, UserActivityDocument } from './schemas/user-activity.schema';
import { UserStatus, BreakReason } from './user-status.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(UserActivity.name)
    private activityModel: Model<UserActivityDocument>,
  ) { }

  async updateStatus(userId: any, status: UserStatus, breakReason?: BreakReason, notes?: string) {
    const user = await this.userModel.findById(userId);
    if (!user) return null;

    // Log the activity
    const activity = new this.activityModel({
      user: userId,
      status,
      breakReason,
      notes,
    });
    await activity.save();

    // Update user current status
    user.currentStatus = status;
    user.lastStatusChange = new Date();
    return user.save();
  }

  async addTrustedDevice(userId: any, deviceInfo: string) {
    return this.userModel.findByIdAndUpdate(
      userId,
      { $addToSet: { trustedDevices: deviceInfo } },
      { new: true }
    ).exec();
  }

  // --- Security: Device Fingerprints ---

  async addAllowedDevice(userId: any, fingerprint: string) {
    return this.userModel.findByIdAndUpdate(
      userId,
      { $addToSet: { allowedDeviceFingerprints: fingerprint } },
      { new: true }
    ).exec();
  }

  async removeAllowedDevice(userId: any, fingerprint: string) {
    return this.userModel.findByIdAndUpdate(
      userId,
      { $pull: { allowedDeviceFingerprints: fingerprint } },
      { new: true }
    ).exec();
  }

  async getUserActivities(userId: any, limit: number = 50) {
    return this.activityModel.find({ user: userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .exec();
  }

  async getAllUserActivities(limit: number = 100) {
    return this.activityModel.find()
      .populate('user', 'id name email role avatar currentStatus')
      .sort({ timestamp: -1 })
      .limit(limit)
      .exec();
  }

  async findOneByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async create(userData: Partial<User>): Promise<UserDocument> {
    const user = new this.userModel(userData);
    return user.save();
  }

  async findAll(search?: string): Promise<User[]> {
    const filter = search ? {
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    } : {};

    return this.userModel.find(filter)
      .select('id name email role avatar currentStatus createdAt fcmToken')
      .exec();
  }

  async findAllOnline() {
    return this.userModel.find({
      currentStatus: { $in: [UserStatus.ONLINE, UserStatus.BUSY, UserStatus.BREAK] }
    }).select('id name currentStatus').exec();
  }

  async findOne(id: any): Promise<User | null> {
    return this.userModel.findById(id)
      .select('id name email role avatar currentStatus createdAt fcmToken')
      .exec();
  }

  async findOneWithPassword(id: any): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async update(id: any, updateData: Partial<User>): Promise<User | null> {
    return this.userModel.findByIdAndUpdate(id, updateData, { new: true })
      .select('id name email role avatar currentStatus createdAt')
      .exec();
  }

  async updateAuthData(id: any, updateData: Partial<User>) {
    return this.userModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
  }

  async remove(id: any): Promise<void> {
    await this.userModel.findByIdAndDelete(id).exec();
  }
}
