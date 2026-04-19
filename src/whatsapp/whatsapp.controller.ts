import { 
  Controller, 
  Get, 
  Post, 
  Delete, 
  Param, 
  Body, 
  UseGuards, 
  Request,
  Patch 
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
    @Body('content') content: string,
    @Request() req: any
  ) {
    return this.whatsappService.sendMessage(channelId, leadId, content, req.user.userId);
  }

  @Get('channels/:channelId/messages/:phoneNumber')
  async getMessages(
    @Param('channelId') channelId: string,
    @Param('phoneNumber') phoneNumber: string
  ) {
    return this.whatsappService.getMessages(channelId, phoneNumber);
  }
}
