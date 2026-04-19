import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { WhatsappChannel, WhatsappChannelSchema } from './schemas/whatsapp-channel.schema';
import { WhatsappMessage, WhatsappMessageSchema } from './schemas/whatsapp-message.schema';
import { WhatsappSession, WhatsappSessionSchema } from './schemas/whatsapp-session.schema';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappProcessor } from './whatsapp.processor';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsappChannel.name, schema: WhatsappChannelSchema },
      { name: WhatsappMessage.name, schema: WhatsappMessageSchema },
      { name: WhatsappSession.name, schema: WhatsappSessionSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    BullModule.registerQueue({
      name: 'whatsapp-messages',
    }),
    UsersModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsappProcessor],
  exports: [WhatsappService],
})
export class WhatsappModule {}
