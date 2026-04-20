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

    // Bypass 2FA and Login Requests - Allow direct login for everyone as requested
    return this.authService.login(user);
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
