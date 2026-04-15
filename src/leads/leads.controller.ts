import { Controller, Get, Post, Body, Param, Put, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto, UpdateLeadDto, QueryLeadsDto } from './leads.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../users/roles.enum';

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) { }

  @Get()
  async findAll(@Query() query: QueryLeadsDto, @Request() req) {
    return this.leadsService.findAll(query, req.user);
  }

  @Post()
  async create(@Body() createLeadDto: CreateLeadDto, @Request() req) {
    return this.leadsService.create(createLeadDto, req.user);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateLeadDto: UpdateLeadDto) {
    return this.leadsService.update(id, updateLeadDto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  async remove(@Param('id') id: string) {
    return this.leadsService.remove(id);
  }

  @Get('reminders')
  async getReminders(@Request() req) {
    return this.leadsService.getPendingReminders(req.user.userId);
  }

  @Post('mark-as-read')
  async markAsRead(@Request() req) {
    return this.leadsService.markRemindersAsRead(req.user.userId);
  }
  @Get('all-reminders')
  async getAllReminders(@Request() req, @Query('page') page: string, @Query('limit') limit: string) {
    return this.leadsService.getAllReminders(req.user.userId, { 
      page: page ? parseInt(page, 10) : 1, 
      limit: limit ? parseInt(limit, 10) : 10 
    });
  }

  @Post('bulk-import')
  async bulkImport(@Body() leads: CreateLeadDto[], @Request() req) {
    return this.leadsService.bulkCreate(leads, req.user);
  }

  @Get('export')
  async exportLeads(@Request() req) {
    return this.leadsService.exportAll(req.user);
  }
}
