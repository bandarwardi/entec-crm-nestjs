import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../users/roles.enum';

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, SessionGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('today')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getTodayAdminStats(@Query('date') date?: string) {
    return this.dashboardService.getTodayAdminStats(date);
  }
}
