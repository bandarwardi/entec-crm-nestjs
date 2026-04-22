import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoginRequest, LoginRequestDocument } from './schemas/login-request.schema';
import { LoginChallenge, LoginChallengeDocument } from './schemas/login-challenge.schema';
import { UserStatus } from '../users/user-status.enum';
import { FirebaseService } from '../firebase/firebase.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private workSettingsService: WorkSettingsService,
    private jwtService: JwtService,
    private firebaseService: FirebaseService,
    @InjectModel(LoginRequest.name) private loginRequestModel: Model<LoginRequestDocument>,
    @InjectModel(LoginChallenge.name) private loginChallengeModel: Model<LoginChallengeDocument>
  ) {}

  // ==============================================================
  //                 NEW MULTI-LAYER MFA LOGIN LOGIC
  // ==============================================================

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (user && await bcrypt.compare(pass, (user as any).passwordHash)) {
      const result = (user as any).toObject ? (user as any).toObject() : { ...user };
      delete result.passwordHash;
      return result;
    }
    return null;
  }

  async login(user: any, deviceFingerprint: string, ipAddress: string, browserInfo: string) {
    const settings = await this.workSettingsService.getSettings();
    const isSecurityEnabled = settings.securityEnabled;

    if (!isSecurityEnabled || user.securityBypass) {
      // Direct login allowed
      return this.generateAuthData(user);
    }

    if (!deviceFingerprint) {
      throw new BadRequestException('معرف الجهاز مفقود');
    }

    const fullUser: any = await this.usersService.findOneWithPassword(user.id || user._id);
    const allowedDevices = fullUser.allowedDeviceFingerprints || [];

    if (!allowedDevices.includes(deviceFingerprint)) {
      throw new UnauthorizedException('هذا الجهاز غير مصرح له بالدخول. تواصل مع الإدارة.');
    }

    if (!fullUser.biometricRegistered) {
      throw new UnauthorizedException('يرجى تسجيل بصمتك عبر تطبيق الهاتف أولاً.');
    }

    if (!fullUser.fcmToken) {
      throw new UnauthorizedException('تطبيق الهاتف الخاص بك غير مهيأ لاستقبال الطلبات.');
    }

    const challengeToken = crypto.randomUUID();
    const expiryMins = settings.challengeExpiryMinutes || 5;
    const expiresAt = new Date(Date.now() + expiryMins * 60000);

    const challenge = new this.loginChallengeModel({
      user: fullUser._id,
      challengeToken,
      status: 'pending',
      deviceFingerprint,
      ipAddress,
      browserInfo,
      expiresAt,
    });
    await challenge.save();

    try {
      await this.firebaseService.getMessaging().send({
        token: fullUser.fcmToken,
        notification: {
          title: 'محاولة دخول لـ EN-TEC CRM',
          body: `يتم محاولة الدخول من IP: ${ipAddress}`
        },
        data: { challengeToken }
      });
    } catch (e) {
      this.logger.error('Failed to send FCM push', e);
      throw new BadRequestException('تعذر إرسال الإشعار إلى هاتفك. يرجى التأكد من اتصال التطبيق.');
    }

    return { 
      challengeToken, 
      expiresAt,
      message: 'بانتظار التأكيد من تطبيق الهاتف' 
    };
  }

  async getChallengeStatus(challengeToken: string) {
    const challenge = await this.loginChallengeModel.findOne({ challengeToken }).populate('user').exec();
    if (!challenge) {
      throw new BadRequestException('طلب الدخول غير صالح أو غير موجود');
    }

    if (challenge.status === 'pending' && challenge.expiresAt < new Date()) {
      challenge.status = 'expired';
      await challenge.save();
    }

    if (challenge.status === 'approved') {
      return { 
        status: 'approved', 
        jwtToken: challenge.jwtToken,
        user: {
          id: (challenge.user as any)._id,
          name: (challenge.user as any).name,
          email: (challenge.user as any).email,
          role: (challenge.user as any).role
        }
      };
    }

    return { status: challenge.status };
  }

  async approveChallenge(challengeToken: string, lat: number, lng: number) {
    const challenge = await this.loginChallengeModel.findOne({ challengeToken }).populate('user').exec();
    if (!challenge) throw new BadRequestException('الطلب غير صحيح');
    if (challenge.status !== 'pending') throw new BadRequestException('تم اتخاذ إجراء على هذا الطلب من قبل');
    if (challenge.expiresAt < new Date()) {
      challenge.status = 'expired';
      await challenge.save();
      throw new BadRequestException('انتهت صلاحية الطلب');
    }

    const zones = await this.workSettingsService.getZones();
    const activeZones = zones.filter(z => z.isActive);

    let matchedZone: any = null;

    if (activeZones.length === 0) {
       matchedZone = { name: 'أي مكان (لا توجد مناطق محددة)' };
    } else {
        for (const zone of activeZones) {
          const distance = this.calculateDistance(lat, lng, zone.latitude, zone.longitude);
          if (distance <= zone.radiusMeters) {
            matchedZone = zone;
            break;
          }
        }
    }

    if (!matchedZone) {
      challenge.status = 'rejected';
      await challenge.save();
      throw new UnauthorizedException('الموقع خارج نطاق جميع مكاتب العمل المسموحة');
    }

    const authData = await this.generateAuthData(challenge.user);

    challenge.status = 'approved';
    challenge.approvedLatitude = lat;
    challenge.approvedLongitude = lng;
    challenge.approvedZoneName = matchedZone.name;
    challenge.jwtToken = authData.access_token;
    await challenge.save();

    return { success: true, message: 'تم إقرار الدخول بنجاح' };
  }

  async rejectChallenge(challengeToken: string) {
    await this.loginChallengeModel.findOneAndUpdate({ challengeToken }, { status: 'rejected' });
    return { success: true };
  }

  async mobileLogin(user: any) {
    return this.generateAuthData(user); // Grants application a valid token for push and interaction
  }

  async registerBiometric(userId: string) {
    await this.usersService.updateAuthData(userId, { biometricRegistered: true });
    return { success: true };
  }

  async registerFcmToken(userId: string, fcmToken: string) {
     await this.usersService.updateAuthData(userId, { fcmToken });
     return { success: true };
  }

  private async generateAuthData(user: any) {
    const userId = (user.id || user._id).toString();
    const payload = { email: user.email, sub: userId, role: user.role, name: user.name };
    await this.usersService.updateStatus(userId, UserStatus.ONLINE);
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: userId,
        name: user.name,
        email: user.email,
        role: user.role
      }
    };
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; 
  }

  // ==============================================================
  //                 OLD LOGIN LOGIC (FALLBACK / ADMIN)
  // ==============================================================

  async submitLoginRequest(user: any, data: { lat: number, lng: number, device: string, ip: string }) { return null; }

  async findApprovedRequest(userId: string) { return null; }

  async getAllPending() { return []; }

  async getAllHistory() { return []; }

  async updateRequestStatus(id: string, status: string, trustDevice?: boolean) { return null; }

  async logout(userId: any) {
    return this.usersService.updateStatus(userId, UserStatus.OFFLINE);
  }

  async verifyPassword(userId: string, pass: string): Promise<boolean> {
    const user = await this.usersService.findOneWithPassword(userId);
    if (!user || !(user as any).passwordHash) return false;
    return bcrypt.compare(pass, (user as any).passwordHash);
  }
}
