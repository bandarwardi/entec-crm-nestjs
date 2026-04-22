import { Controller, Get, Put, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { WorkSettingsService } from './work-settings.service';
import { WorkSettings } from './schemas/work-settings.schema';
import { Holiday } from './schemas/holiday.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../users/roles.enum';

@Controller('work-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkSettingsController {
  constructor(private readonly workSettingsService: WorkSettingsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getSettings(): Promise<WorkSettings> {
    return this.workSettingsService.getSettings();
  }

  @Put()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async updateSettings(@Body() data: Partial<WorkSettings>): Promise<WorkSettings> {
    return this.workSettingsService.updateSettings(data);
  }

  @Get('holidays')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getHolidays(): Promise<Holiday[]> {
    return this.workSettingsService.getHolidays();
  }

  @Post('holidays')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async addHoliday(@Body() data: Partial<Holiday>): Promise<Holiday> {
    return this.workSettingsService.addHoliday(data);
  }

  @Delete('holidays/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async deleteHoliday(@Param('id') id: string): Promise<void> {
    return this.workSettingsService.deleteHoliday(id);
  }

  // --- Allowed Zones ---

  @Get('zones')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getZones() {
    return this.workSettingsService.getZones();
  }

  @Post('zones')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async addZone(@Body() data: any) {
    return this.workSettingsService.addZone(data);
  }

  @Put('zones/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async updateZone(@Param('id') id: string, @Body() data: any) {
    return this.workSettingsService.updateZone(id, data);
  }

  @Delete('zones/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async deleteZone(@Param('id') id: string): Promise<void> {
    return this.workSettingsService.deleteZone(id);
  }
}
