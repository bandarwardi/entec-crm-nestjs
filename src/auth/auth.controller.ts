import { Controller, Post, Body, UnauthorizedException, Get, Param, Put, Delete, UseGuards, Ip, Request, BadRequestException, Res, HttpCode, Query, Headers, Req } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { Role } from '../users/roles.enum';
import { SkipSession } from './skip-session.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // ==============================================================
  //                 NEW MULTI-LAYER MFA LOGIN ENDPOINTS
  // ==============================================================

  @SkipSession()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: any,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(body.email || body.username, body.password);

    if (!user) {
      await this.authService.recordLoginAttempt({
        email: body.email || body.username,
        status: 'failure',
        ipAddress: req.ip || '',
        deviceInfo: body.browserInfo || 'متصفح ويب',
        platform: 'web',
        failureReason: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
      });
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    const result = await this.authService.login(
      user, 
      body.deviceFingerprint, 
      req.ip || '', 
      body.browserInfo || 'متصفح ويب',
      body.latitude,
      body.longitude,
      body.managerToken
    );

    if ((result as any).user?.id) {
      res.cookie('crm_user', (result as any).user.id, {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 1 day
      });
    }

    return result;
  }

  @SkipSession()
  @Post('desktop/login')
  @HttpCode(200)
  async desktopLogin(@Body() body: any) {
    const result = await this.authService.desktopLogin(body.username, body.password).catch(async (e) => {
      await this.authService.recordLoginAttempt({
        email: body.username,
        status: 'failure',
        platform: 'desktop',
        deviceInfo: 'Desktop Application',
        failureReason: e.message
      });
      throw e;
    });
    return result;
  }

  @SkipSession()
  @Get('challenge-status/:token')
  async getChallengeStatus(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
     if (!token) throw new BadRequestException('Token required');
     const result = await this.authService.getChallengeStatus(token);

     if ((result as any).status === 'approved' && (result as any).user?.id) {
       res.cookie('crm_user', (result as any).user.id, {
         httpOnly: true,
         sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
         secure: process.env.NODE_ENV === 'production',
         maxAge: 24 * 60 * 60 * 1000, // 1 day
       });
     }

     return result;
  }

  @Post('approve-challenge')
  @UseGuards(JwtAuthGuard)
  async approveChallenge(@Body() body: { token: string, lat: number, lng: number }) {
    if (!body.token || body.lat === undefined || body.lng === undefined) {
      throw new BadRequestException('Missing parameters');
    }
    return this.authService.approveChallenge(body.token, body.lat, body.lng);
  }

  @Post('reject-challenge')
  @UseGuards(JwtAuthGuard)
  async rejectChallenge(@Body('token') token: string) {
    if (!token) throw new BadRequestException('Token required');
    return this.authService.rejectChallenge(token);
  }

  @SkipSession()
  @Post('mobile-login')
  async mobileLogin(@Body() body: any, @Ip() ip: string) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      await this.authService.recordLoginAttempt({
        email: body.email,
        status: 'failure',
        ipAddress: ip,
        platform: 'mobile',
        deviceInfo: 'تطبيق الهاتف (Mobile App)',
        failureReason: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
      });
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }
    return this.authService.mobileLogin(user, body.deviceFingerprint, ip);
  }

  @Post('register-biometric')
  @UseGuards(JwtAuthGuard)
  async registerBiometric(@Request() req: any) {
    return this.authService.registerBiometric(req.user.userId);
  }

  @Post('register-fcm')
  @UseGuards(JwtAuthGuard)
  async registerFcm(@Body('token') token: string, @Request() req: any) {
    if (!token) throw new BadRequestException('Token required');
    return this.authService.registerFcmToken(req.user.userId, token);
  }

  // ==============================================================
  //                 EXISTING ENDPOINTS
  // ==============================================================

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  async refresh(@Body() user: any) {
    // Legacy refresh logic
    return this.authService.mobileLogin(user);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Request() req: any) {
    return this.authService.logout(req.user.userId);
  }

  @Get('pending-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getPendingRequests() {
    return this.authService.getAllPending();
  }

  @Get('history-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getHistoryRequests() {
    return this.authService.getAllHistory();
  }

  @Put('request/:id/:status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async updateStatus(@Param('id') id: string, @Param('status') status: string, @Body('trustDevice') trustDevice?: boolean) {
    return this.authService.updateRequestStatus(id, status, trustDevice);
  }

  @Get('login-logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getLoginLogs(@Query() query: any) {
    return this.authService.getLoginLogs(query);
  }
  
  @Post('verify-password')
  @UseGuards(JwtAuthGuard)
  async verifyPassword(@Body('password') password: string, @Request() req: any) {
    const isValid = await this.authService.verifyPassword(req.user.userId, password);
    return { isValid };
  }

  @Get('presence-status')
  @UseGuards(JwtAuthGuard)
  async getPresenceStatus(@Request() req: any) {
    const isActive = this.authService.isPresenceActive(req.user.userId);
    return { isActive };
  }

  // --- Desktop Users Management Endpoints ---
  @Get('desktop-users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getDesktopUsers() {
    return this.authService.getAllDesktopUsers();
  }

  @Post('desktop-users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async createDesktopUser(@Body() data: any) {
    return this.authService.createDesktopUser(data);
  }

  @Put('desktop-users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async updateDesktopUser(@Param('id') id: string, @Body() data: any) {
    return this.authService.updateDesktopUser(id, data);
  }

  @Delete('desktop-users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async deleteDesktopUser(@Param('id') id: string) {
    return this.authService.deleteDesktopUser(id);
  }
  @Get('debug-cookies')
  async debugCookies(@Req() req: any) {
    return { 
      cookies: req.cookies,
      crm_user: req.cookies?.['crm_user']
    };
  }

  @SkipSession()
  @Get('verify-manager-token')
  async verifyManagerToken(@Query('token') token: string) {
    const isValid = await this.authService.verifyManagerToken(token);
    return { isValid };
  }
}
