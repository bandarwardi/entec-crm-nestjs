import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoginRequest, LoginRequestDocument } from './schemas/login-request.schema';
import { LoginChallenge, LoginChallengeDocument } from './schemas/login-challenge.schema';
import { DesktopUser, DesktopUserDocument } from './schemas/desktop-user.schema';
import { UserStatus } from '../users/user-status.enum';
import { FirebaseService } from '../firebase/firebase.service';
import * as crypto from 'crypto';
import { WsTokenStore } from './ws-token.store';
import { PresenceService } from '../presence/presence.service';
import { LoginLog, LoginLogDocument } from './schemas/login-log.schema';


@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private workSettingsService: WorkSettingsService,
    private jwtService: JwtService,
    private firebaseService: FirebaseService,

    private readonly wsTokenStore: WsTokenStore,
    private readonly presenceService: PresenceService,
    @InjectModel(LoginRequest.name) private loginRequestModel: Model<LoginRequestDocument>,
    @InjectModel(LoginChallenge.name) private loginChallengeModel: Model<LoginChallengeDocument>,
    @InjectModel(DesktopUser.name) private desktopUserModel: Model<DesktopUserDocument>,
    @InjectModel(LoginLog.name) private loginLogModel: Model<LoginLogDocument>
  ) {}



  async validateDesktopUser(username: string, pass: string): Promise<any> {
    const user = await this.desktopUserModel.findOne({ username, isActive: true }).exec();
    if (user && await bcrypt.compare(pass, user.passwordHash)) {
      const { passwordHash, ...result } = user.toObject();
      return { ...result, _id: user._id };
    }
    return null;
  }

  async desktopLogin(username: string, pass: string) {
    const user = await this.validateDesktopUser(username, pass);
    if (!user) {
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    // Issue token for the linked CRM user if available, otherwise for the desktop user itself
    const targetUserId = user.linkedUser || user._id.toString();
    const wsToken = this.wsTokenStore.issue(targetUserId);

    await this.recordLoginAttempt({
      user: user.linkedUser || user._id,
      email: username,
      status: 'success',
      platform: 'desktop',
      deviceInfo: 'Desktop Application'
    });
    
    // If there is a linked CRM user, generate a real JWT for them
    let authData: any = null;
    if (user.linkedUser) {
      const linkedCRMUser = await this.usersService.findOne(user.linkedUser);
      if (linkedCRMUser) {
        authData = await this.generateAuthData(linkedCRMUser);
      }
    }

    return {
      status: 'ok',
      wsToken,
      access_token: authData ? authData.access_token : 'no-link-session',
      user: authData ? authData.user : {
        id: user._id,
        name: user.name,
        username: user.username,
        isUnlinked: true
      }
    };
  }

  // --- Desktop Users Management ---
  async getAllDesktopUsers() {
    return this.desktopUserModel.find().select('-passwordHash').exec();
  }

  async createDesktopUser(data: any) {
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = new this.desktopUserModel({ ...data, passwordHash });
    return user.save();
  }

  async updateDesktopUser(id: string, data: any) {
    if (data.password) {
      data.passwordHash = await bcrypt.hash(data.password, 10);
      delete data.password;
    }
    return this.desktopUserModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async deleteDesktopUser(id: string) {
    return this.desktopUserModel.findByIdAndDelete(id).exec();
  }


  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (user && await bcrypt.compare(pass, (user as any).passwordHash)) {
      const result = (user as any).toObject ? (user as any).toObject() : { ...user };
      delete result.passwordHash;
      return result;
    }
    return null;
  }

  async login(user: any, deviceFingerprint: string, ipAddress: string, browserInfo: string, latitude?: number, longitude?: number, managerToken?: string) {
    const settings = await this.workSettingsService.getSettings();
    const isSecurityEnabled = settings.securityEnabled;

    if (!isSecurityEnabled || user.securityBypass) {
      // Direct login allowed
      return this.generateAuthData(user);
    }

    // NEW: Manager Token Bypass
    if (managerToken && settings.managerLoginToken && managerToken === settings.managerLoginToken) {
        if (user.role === 'admin' || user.role === 'super-admin') {
            this.logger.log(`[Auth] User ${user.email} bypassed security via manager token.`);
            return this.generateAuthData(user, true);
        }
    }

    if (!deviceFingerprint && !browserInfo?.includes('Python Desktop Gateway')) {
      throw new BadRequestException('معرف الجهاز مفقود');
    }
    
    // Normalize fingerprint
    const currentFingerprint = (deviceFingerprint || 'unknown-device').trim().toLowerCase();

    const fullUser: any = await this.usersService.findOneWithPassword(user.id || user._id);
    const allowedDevices = (fullUser.allowedDeviceFingerprints || []).map(d => d.trim().toLowerCase());

    this.logger.log(`[Auth] User ${fullUser.email} attempting login.`);
    this.logger.log(`[Auth] Incoming fingerprint: [${currentFingerprint}]`);
    this.logger.log(`[Auth] Allowed fingerprints for this user: ${JSON.stringify(allowedDevices)}`);

    const isAllowed = allowedDevices.includes(currentFingerprint);

    if (!isAllowed) {
      this.logger.warn(`[Auth] Fingerprint NOT matched. Device is not in allowed list.`);
      const existingRequest = await this.loginRequestModel.findOne({ 
        user: fullUser._id, 
        deviceFingerprint: currentFingerprint, 
        status: 'pending' 
      });

      if (!existingRequest) {
        const newRequest = new this.loginRequestModel({
          user: fullUser._id,
          deviceFingerprint: currentFingerprint,
          deviceInfo: browserInfo,
          ipAddress,
          latitude,
          longitude,
          status: 'pending'
        });
        await newRequest.save();
      }

      await this.recordLoginAttempt({
        user: fullUser._id,
        email: user.email,
        status: 'request_pending',
        ipAddress,
        deviceFingerprint: currentFingerprint,
        deviceInfo: browserInfo,
        platform: 'web'
      });

      return { 
        status: 'request_pending', 
        message: 'جهازك غير مسجل. تم إرسال طلب اعتماد لجهازك إلى الإدارة، يرجى المحاولة لاحقاً بعد الموافقة.' 
      };
    }

    await this.recordLoginAttempt({
      user: fullUser._id,
      email: user.email,
      status: 'success',
      ipAddress,
      deviceFingerprint: currentFingerprint,
      deviceInfo: browserInfo,
      platform: 'web'
    });

    // --- TEMPORARY BYPASS: Mobile App Challenge ---
    // (Bypassed until app store developer accounts are ready)
    return this.generateAuthData(fullUser);

    /* 
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
    */
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
      const userId = (challenge.user as any)._id.toString();
      const wsToken = this.wsTokenStore.issue(userId);
      return { 
        status: 'approved', 
        jwtToken: challenge.jwtToken,
        wsToken,
        user: {
          id: userId,
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

  async mobileLogin(user: any, deviceFingerprint?: string, ipAddress?: string) {
    if (deviceFingerprint) {
      const fullUser: any = await this.usersService.findOneWithPassword(user.id || user._id);
      const allowedDevices = fullUser.allowedDeviceFingerprints || [];
      const currentFingerprint = deviceFingerprint.trim().toLowerCase();

      if (!allowedDevices.map(d => d.trim().toLowerCase()).includes(currentFingerprint)) {
        // Create request for this mobile device if it doesn't exist
        const existingRequest = await this.loginRequestModel.findOne({ 
          user: fullUser._id, 
          deviceFingerprint: currentFingerprint, 
          status: 'pending' 
        });

        if (!existingRequest) {
          const newRequest = new this.loginRequestModel({
            user: fullUser._id,
            deviceFingerprint: currentFingerprint,
            deviceInfo: 'تطبيق الهاتف (Mobile App)',
            ipAddress,
            status: 'pending'
          });
          await newRequest.save();
        }

        await this.recordLoginAttempt({
          user: fullUser._id,
          email: fullUser.email,
          status: 'rejected',
          ipAddress,
          deviceFingerprint: currentFingerprint,
          deviceInfo: 'تطبيق الهاتف (Mobile App)',
          platform: 'mobile',
          failureReason: 'الجهاز غير مسجل'
        });

        throw new UnauthorizedException('جهاز الهاتف هذا غير مسجل. تم إرسال طلب اعتماد للإدارة، يرجى المحاولة بعد الموافقة.');
      }
    }

    await this.recordLoginAttempt({
      user: user.id || user._id,
      email: user.email,
      status: 'success',
      ipAddress,
      deviceFingerprint,
      deviceInfo: 'تطبيق الهاتف (Mobile App)',
      platform: 'mobile'
    });

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

  private async generateAuthData(user: any, isManagerBypass: boolean = false) {
    const userId = (user.id || user._id).toString();
    
    // Start grace period in PresenceService
    this.presenceService.recordLogin(userId, isManagerBypass);

    const payload = { email: user.email, sub: userId, role: user.role, name: user.name };
    await this.usersService.updateStatus(userId, UserStatus.ONLINE);
    const wsToken = this.wsTokenStore.issue(userId);
    return {
      access_token: this.jwtService.sign(payload),
      wsToken,
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

  async getAllPending() {
    return this.loginRequestModel.find({ status: 'pending' })
      .populate('user', 'id name email role avatar')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getAllHistory() {
    return this.loginRequestModel.find({ status: { $ne: 'pending' } })
      .populate('user', 'id name email role avatar')
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
  }

  async updateRequestStatus(id: string, status: string, trustDevice?: boolean) {
    const request = await this.loginRequestModel.findById(id);
    if (!request) throw new BadRequestException('الطلب غير موجود');

    if (status === 'approved') {
      // Ensure we use the raw ID even if populated
      const userId = (request.user as any)._id || request.user;
      await this.usersService.addAllowedDevice(userId.toString(), request.deviceFingerprint);
      this.logger.log(`[Auth] Fingerprint ${request.deviceFingerprint} added to user ${userId} allowed list.`);
    }

    request.status = status;
    await request.save();

    return { success: true };
  }

  async logout(userId: any) {
    this.presenceService.clearManagerBypass(userId.toString());
    return this.usersService.updateStatus(userId, UserStatus.OFFLINE);
  }

  async verifyPassword(userId: string, pass: string): Promise<boolean> {
    const user = await this.usersService.findOneWithPassword(userId);
    if (!user || !(user as any).passwordHash) return false;
    return bcrypt.compare(pass, (user as any).passwordHash);
  }

  isPresenceActive(userId: string): boolean {
    return this.presenceService.isActive(userId);
  }

  async recordLoginAttempt(data: {
    user?: any;
    email?: string;
    status: string;
    ipAddress?: string;
    deviceFingerprint?: string;
    deviceInfo?: string;
    failureReason?: string;
    platform?: string;
  }) {
    try {
      const log = new this.loginLogModel({
        user: data.user,
        email: data.email,
        status: data.status,
        ipAddress: data.ipAddress,
        deviceFingerprint: data.deviceFingerprint,
        deviceInfo: data.deviceInfo,
        failureReason: data.failureReason,
        platform: data.platform || 'web'
      });
      await log.save();
    } catch (e) {
      this.logger.error('Failed to record login log', e);
    }
  }

  async getLoginLogs(query: { page?: number; limit?: number; userId?: string }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (query.userId) {
      filter.user = query.userId;
    }

    const [data, total] = await Promise.all([
      this.loginLogModel.find(filter)
        .populate('user', 'name email role avatar')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.loginLogModel.countDocuments(filter).exec()
    ]);

    return { data, total, page, limit };
  }

  async verifyManagerToken(token: string): Promise<boolean> {
    const settings = await this.workSettingsService.getSettings();
    return !!settings.managerLoginToken && token === settings.managerLoginToken;
  }
}
