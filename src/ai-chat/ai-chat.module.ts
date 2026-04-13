import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiMessage } from './entities/ai-message.entity';
import { SalesScenario } from './entities/sales-scenario.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiConversation, AiMessage, SalesScenario])
  ],
  providers: [AiChatService],
  controllers: [AiChatController],
})
export class AiChatModule {}
