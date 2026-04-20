import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoginRequest, LoginRequestDocument } from './schemas/login-request.schema';
import { UserStatus } from '../users/user-status.enum';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private firebaseService: FirebaseService,
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

  async updateRequestStatus(id: string, status: string, trustDevice?: boolean) {
    const request = await this.loginRequestModel.findByIdAndUpdate(id, { status }, { new: true }).exec();
    if (status === 'approved' && trustDevice && request) {
      await this.usersService.addTrustedDevice(request.user.toString(), request.deviceInfo);
    }
    return request;
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
    const userId = (user.id || user._id).toString();
    const payload = { email: user.email, sub: userId, role: user.role, name: user.name };
    
    // Set user to online when logging in
    await this.usersService.updateStatus(userId, UserStatus.ONLINE);

    let firebaseToken: string | null = null;
    /* Disabling Firebase token generation to resolve (auth/invalid-custom-token)
    try {
      firebaseToken = await this.firebaseService.getAuth().createCustomToken(userId);
    } catch (error) {
      console.error('Failed to create Firebase custom token', error);
    }
    */

    return {
      access_token: this.jwtService.sign(payload),
      firebaseToken,
      user: {
        id: userId,
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
    const user = await this.usersService.findOneWithPassword(userId);
    if (!user || !(user as any).passwordHash) return false;
    return bcrypt.compare(pass, (user as any).passwordHash);
  }
}
