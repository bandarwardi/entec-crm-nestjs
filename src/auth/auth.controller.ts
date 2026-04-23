import { Controller, Post, Body, UnauthorizedException, Get, Param, Put, UseGuards, Ip, Request, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { Role } from '../users/roles.enum';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // ==============================================================
  //                 NEW MULTI-LAYER MFA LOGIN ENDPOINTS
  // ==============================================================

  @Post('login')
  async login(@Body() body: any, @Ip() ip: string) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    // Call login with fingerprint, ip, browser, and optional coordinates
    return this.authService.login(
      user, 
      body.deviceFingerprint, 
      ip, 
      body.browserInfo || 'متصفح ويب',
      body.latitude,
      body.longitude
    );
  }

  @Get('challenge-status/:token')
  async getChallengeStatus(@Param('token') token: string) {
     if (!token) throw new BadRequestException('Token required');
     return this.authService.getChallengeStatus(token);
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

  @Post('mobile-login')
  async mobileLogin(@Body() body: any) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }
    return this.authService.mobileLogin(user);
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
  
  @Post('verify-password')
  @UseGuards(JwtAuthGuard)
  async verifyPassword(@Body('password') password: string, @Request() req: any) {
    const isValid = await this.authService.verifyPassword(req.user.userId, password);
    return { isValid };
  }
}
