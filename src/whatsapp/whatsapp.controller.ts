import { 
  Controller, 
  Get, 
  Post, 
  Delete, 
  Param, 
  Body, 
  UseGuards, 
  Request,
  Patch,
  Query
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('channels')
  getChannels(@Request() req: any) {
    return this.whatsappService.getChannels(req.user);
  }

  @Post('channels')
  createChannel(@Body('label') label: string, @Request() req: any) {
    return this.whatsappService.createChannel(label, req.user.userId);
  }

  @Delete('channels/:id')
  deleteChannel(@Param('id') id: string) {
    return this.whatsappService.deleteChannel(id);
  }

  @Post('channels/:id/reconnect')
  reconnect(@Param('id') id: string) {
    return this.whatsappService.reconnect(id);
  }

  @Patch('channels/:id/agents')
  async updateChannelAgents(
    @Param('id') id: string,
    @Body('agents') agents: string[],
    @Body('allAgentsAccess') allAgentsAccess: boolean
  ) {
    return this.whatsappService.updateChannelAgents(id, agents, allAgentsAccess);
  }

  @Post('messages/send')
  sendMessage(
    @Body('channelId') channelId: string,
    @Body('leadId') leadId: string,
    @Body('phoneNumber') phoneNumber: string,
    @Body('content') content: string,
    @Body('messageType') messageType: string,
    @Body('mediaUrl') mediaUrl: string,
    @Body('quotedMessageId') quotedMessageId: string,
    @Body('quotedContent') quotedContent: string,
    @Request() req: any
  ) {
    return this.whatsappService.sendMessage(
      channelId, 
      leadId, 
      phoneNumber,
      content, 
      req.user.userId, 
      req.user.name, 
      messageType, 
      mediaUrl,
      quotedMessageId,
      quotedContent
    );
  }

  @Get('channels/:channelId/messages/:phoneNumber')
  async getMessages(
    @Param('channelId') channelId: string,
    @Param('phoneNumber') phoneNumber: string
  ) {
    return this.whatsappService.getMessages(channelId, phoneNumber);
  }

  @Get('channels/:channelId/check-number')
  async checkNumber(
    @Param('channelId') channelId: string,
    @Query('phoneNumber') phoneNumber: string
  ) {
    return this.whatsappService.checkPhoneNumber(channelId, phoneNumber);
  }

  @Get('ai-settings')
  getAiSettings() {
    return this.whatsappService.getAiSettings();
  }

  @Post('ai-settings')
  updateAiSettings(@Body() data: any) {
    return this.whatsappService.updateAiSettings(data);
  }

  @Post('ai-suggest')
  generateAiSuggestion(
    @Body('channelId') channelId: string,
    @Body('phoneNumber') phoneNumber: string
  ) {
    return this.whatsappService.generateAiSuggestion(channelId, phoneNumber);
  }
  
  @Post('leads/:id/mark-as-read')
  async markAsRead(@Param('id') id: string) {
    return this.whatsappService.markAsRead(id);
  }

  @Get('templates')
  getTemplates() {
    return this.whatsappService.getTemplates();
  }

  @Post('templates')
  createTemplate(@Body() data: any, @Request() req: any) {
    return this.whatsappService.createTemplate(data, req.user.userId);
  }

  @Delete('templates/:id')
  deleteTemplate(@Param('id') id: string) {
    return this.whatsappService.deleteTemplate(id);
  }

  @Post('leads/:id/toggle-archive')
  async toggleArchive(@Param('id') id: string) {
    return this.whatsappService.toggleArchive(id);
  }
}
