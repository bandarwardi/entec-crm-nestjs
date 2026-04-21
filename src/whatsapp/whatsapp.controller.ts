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

  @Post('channels/:id/request-pairing-code')
  requestPairingCode(
    @Param('id') id: string,
    @Body('phoneNumber') phoneNumber: string
  ) {
    return this.whatsappService.requestPairingCode(id, phoneNumber);
  }

  @Patch('channels/:id/agents')
  async updateChannelAgents(
    @Param('id') id: string,
    @Body('agents') agents: string[],
    @Body('allAgentsAccess') allAgentsAccess: boolean
  ) {
    return this.whatsappService.updateChannelAgents(id, agents, allAgentsAccess);
  }

  @Get('channels/:id/privacy')
  async fetchPrivacySettings(@Param('id') id: string) {
    return this.whatsappService.fetchPrivacySettings(id);
  }

  @Patch('channels/:id/privacy')
  async updatePrivacySetting(
    @Param('id') id: string,
    @Body('type') type: any,
    @Body('value') value: any
  ) {
    return this.whatsappService.updatePrivacySetting(id, type, value);
  }

  @Post('channels/:id/status')
  async sendStatusUpdate(
    @Param('id') id: string,
    @Body('content') content: string,
    @Body('messageType') messageType: string,
    @Body('mediaUrl') mediaUrl?: string
  ) {
    return this.whatsappService.sendStatusUpdate(id, content, messageType, mediaUrl);
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
  async toggleArchive(
    @Param('id') id: string,
    @Body('channelId') channelId?: string
  ) {
    return this.whatsappService.toggleArchive(id, channelId);
  }

  @Post('chats/modify')
  async modifyChat(
    @Body('channelId') channelId: string,
    @Body('leadId') leadId: string,
    @Body('action') action: any
  ) {
    return this.whatsappService.modifyChat(channelId, leadId, action);
  }

  @Post('presence/update')
  async updatePresence(
    @Body('channelId') channelId: string,
    @Body('leadId') leadId: string,
    @Body('presence') presence: any
  ) {
    return this.whatsappService.updatePresence(channelId, leadId, presence);
  }

  @Post('messages/star')
  async starMessage(
    @Body('channelId') channelId: string,
    @Body('leadId') leadId: string,
    @Body('messageId') messageId: string,
    @Body('star') star: boolean
  ) {
    return this.whatsappService.starMessage(channelId, leadId, messageId, star);
  }

  @Post('users/block')
  async blockUser(
    @Body('channelId') channelId: string,
    @Body('leadId') leadId: string,
    @Body('action') action: 'block' | 'unblock'
  ) {
    return this.whatsappService.blockUser(channelId, leadId, action);
  }

  @Post('leads/:id/fetch-history')
  async fetchHistory(
    @Param('id') leadId: string,
    @Body('channelId') channelId: string,
    @Body('count') count: number
  ) {
    return this.whatsappService.fetchOldMessages(channelId, leadId, count);
  }

  @Post('groups/create')
  async createGroup(
    @Body('channelId') channelId: string,
    @Body('subject') subject: string,
    @Body('participants') participants: string[]
  ) {
    return this.whatsappService.createGroup(channelId, subject, participants);
  }

  @Patch('groups/:jid/participants')
  async updateGroupParticipants(
    @Param('jid') jid: string,
    @Body('channelId') channelId: string,
    @Body('participants') participants: string[],
    @Body('action') action: 'add' | 'remove' | 'promote' | 'demote'
  ) {
    return this.whatsappService.updateGroupParticipants(channelId, jid, participants, action);
  }

  @Patch('groups/:jid/metadata')
  async updateGroupMetadata(
    @Param('jid') jid: string,
    @Body('channelId') channelId: string,
    @Body('action') action: 'subject' | 'description' | 'settings',
    @Body('value') value: string
  ) {
    return this.whatsappService.updateGroupMetadata(channelId, jid, action, value);
  }

  @Post('groups/:jid/leave')
  async leaveGroup(
    @Param('jid') jid: string,
    @Body('channelId') channelId: string
  ) {
    return this.whatsappService.leaveGroup(channelId, jid);
  }

  @Get('groups/:jid/invite-code')
  async getGroupInviteCode(
    @Param('jid') jid: string,
    @Query('channelId') channelId: string
  ) {
    return this.whatsappService.getGroupInviteCode(channelId, jid);
  }
}
