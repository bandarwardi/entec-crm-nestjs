import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Processor('whatsapp-messages')
export class WhatsappProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappProcessor.name);

  constructor(private readonly whatsappService: WhatsappService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { channelId, leadId, content, agentId, messageType, mediaUrl } = job.data;
    
    this.logger.log(`Processing ${messageType || 'text'} message for lead ${leadId} via channel ${channelId}`);
    
    try {
      // Small delay to simulate human-like behavior and prevent bans
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
      
      return await this.whatsappService.sendDirectMessage(channelId, leadId, content, agentId, messageType, mediaUrl);
    } catch (error) {
      this.logger.error(`Failed to process message job ${job.id}: ${error.message}`);
      throw error;
    }
  }
}
