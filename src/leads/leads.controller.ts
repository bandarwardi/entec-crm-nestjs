import { Controller, Get, Post, Body, Param, Put, Delete, Query, UseGuards, Request as NestRequest } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto, UpdateLeadDto, QueryLeadsDto } from './leads.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../users/roles.enum';

import { AuditLogService } from '../audit-log/audit-log.service';

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard, SessionGuard)
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly auditLogService: AuditLogService
  ) { }

  @Get()
  async findAll(@Query() query: QueryLeadsDto, @NestRequest() req: any) {
    return this.leadsService.findAll(query, req.user);
  }

  @Post()
  async create(@Body() createLeadDto: CreateLeadDto, @NestRequest() req: any) {
    const lead = await this.leadsService.create(createLeadDto, req.user);
    if (lead) {
      await this.auditLogService.log({
        user: req.user.id,
        action: 'CREATE_LEAD',
        resource: 'Lead',
        resourceId: (lead as any).id,
        metadata: { phone: createLeadDto.phone, name: createLeadDto.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
    }
    return lead;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateLeadDto: UpdateLeadDto, @NestRequest() req: any) {
    const lead = await this.leadsService.update(id, updateLeadDto);
    await this.auditLogService.log({
      user: req.user.id,
      action: 'UPDATE_LEAD',
      resource: 'Lead',
      resourceId: id,
      metadata: updateLeadDto,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    return lead;
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT)
  async remove(@Param('id') id: string, @NestRequest() req: any) {
    const result = await this.leadsService.remove(id, req.user);
    await this.auditLogService.log({
      user: req.user.id,
      action: 'DELETE_LEAD',
      resource: 'Lead',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    return result;
  }

  @Post('bulk-import')
  async bulkImport(@Body() leads: CreateLeadDto[], @NestRequest() req: any) {
    return this.leadsService.bulkCreate(leads, req.user);
  }

  @Get('export')
  async exportLeads(@NestRequest() req: any) {
    return this.leadsService.exportAll(req.user);
  }

  @Get('reminders')
  async getReminders(@NestRequest() req: any) {
    return this.leadsService.findReminders(req.user);
  }
}
