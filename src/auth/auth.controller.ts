import { Controller, Post, Body, UnauthorizedException, Get, Param, Put, UseGuards, Ip, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { Role } from '../users/roles.enum';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() body: any, @Ip() ip: string) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    // Direct login for Super Admin, or check for approved request
    if (user.role === Role.SUPER_ADMIN) {
      return this.authService.login(user);
    }

    const approved = await this.authService.findApprovedRequest(user.id);
    if (approved) {
      return this.authService.login(user);
    }

    // Otherwise, submit a new request
    await this.authService.submitLoginRequest(user, {
      lat: body.lat,
      lng: body.lng,
      device: body.device || 'Unknown',
      ip: ip
    });

    return { 
      status: 'pending_approval', 
      message: 'تم إرسال طلب تسجيل الدخول للإدمن للموافقة. يرجى المحاولة مرة أخرى بعد الموافقة.' 
    };
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  async refresh(@Body() user: any) {
    return this.authService.login(user);
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
  async updateStatus(@Param('id') id: string, @Param('status') status: string) {
    return this.authService.updateRequestStatus(+id, status);
  }
}
