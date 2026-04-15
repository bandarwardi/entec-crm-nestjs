import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoginRequest, LoginRequestDocument } from './schemas/login-request.schema';
import { UserStatus } from '../users/user-status.enum';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectModel(LoginRequest.name)
    private loginRequestModel: Model<LoginRequestDocument>
  ) {}

  async submitLoginRequest(user: any, data: { lat: number, lng: number, device: string, ip: string }) {
    const request = new this.loginRequestModel({
      user: user.id,
      latitude: data.lat,
      longitude: data.lng,
      deviceInfo: data.device,
      ipAddress: data.ip,
      status: 'pending'
    });
    return request.save();
  }

  async findApprovedRequest(userId: string) {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    return this.loginRequestModel.findOne({
      user: userId,
      status: 'approved',
      createdAt: { $gt: fifteenMinutesAgo }
    }).exec();
  }

  async getAllPending() {
    return this.loginRequestModel.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .populate('user')
      .exec();
  }

  async getAllHistory() {
    return this.loginRequestModel.find({
      status: { $in: ['approved', 'rejected'] }
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('user')
      .exec();
  }

  async updateRequestStatus(id: string, status: string) {
    return this.loginRequestModel.findByIdAndUpdate(id, { status }, { new: true }).exec();
  }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    // User might be a Mongoose document or plain object depending on findOne result
    if (user && await bcrypt.compare(pass, (user as any).passwordHash)) {
      const result = (user as any).toObject ? (user as any).toObject() : { ...user };
      delete result.passwordHash;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id || user._id, role: user.role };
    
    // Set user to online when logging in
    await this.usersService.updateStatus(user.id || user._id, UserStatus.ONLINE);

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id || user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    };
  }

  async logout(userId: any) {
    return this.usersService.updateStatus(userId, UserStatus.OFFLINE);
  }

  async verifyPassword(userId: string, pass: string): Promise<boolean> {
    const user = await this.usersService.findOne(userId);
    if (!user) return false;
    return bcrypt.compare(pass, (user as any).passwordHash);
  }
}
