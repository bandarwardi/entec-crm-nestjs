import { Controller, Post, Body, UseGuards, Get, Param, Request, Delete, Put, Query } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionGuard } from '../auth/session.guard';
import { SalesScenario } from './schemas/sales-scenario.schema';

@Controller('ai-chat')
@UseGuards(JwtAuthGuard, SessionGuard)
export class AiChatController {
  constructor(private readonly aiChatService: AiChatService) {}

  // --- Conversations ---

  @Get('conversations')
  async getConversations(@Request() req) {
    return this.aiChatService.getUserConversations(req.user.userId);
  }

  @Post('conversations')
  async createConversation(@Request() req, @Body('title') title?: string) {
    return this.aiChatService.createConversation(req.user.userId, title);
  }

  @Get('conversations/:id/messages')
  async getMessages(@Param('id') id: string, @Request() req) {
    return this.aiChatService.getConversationMessages(id, req.user.userId);
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body('message') message: string,
    @Request() req
  ) {
    return this.aiChatService.sendMessage(req.user.userId, id, message);
  }

  @Delete('conversations/:id')
  async deleteConversation(@Param('id') id: string, @Request() req) {
    return this.aiChatService.deleteConversation(id, req.user.userId);
  }

  // --- Scenarios ---

  @Get('scenarios')
  async getScenarios() {
    return this.aiChatService.getAllScenarios(true);
  }

  @Get('scenarios/all')
  async getAllScenarios() {
    // Ideally this should be guarded by a RoleGuard (Super Admin)
    return this.aiChatService.getAllScenarios(false);
  }

  @Post('scenarios')
  async createScenario(@Body() data: Partial<SalesScenario>) {
    return this.aiChatService.createScenario(data);
  }

  @Put('scenarios/:id')
  async updateScenario(@Param('id') id: string, @Body() data: Partial<SalesScenario>) {
    return this.aiChatService.updateScenario(id, data);
  }

  @Delete('scenarios/:id')
  async deleteScenario(@Param('id') id: string) {
    return this.aiChatService.deleteScenario(id);
  }
}
