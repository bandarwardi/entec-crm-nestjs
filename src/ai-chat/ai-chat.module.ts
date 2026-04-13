import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiConversation, AiConversationSchema } from './schemas/ai-conversation.schema';
import { AiMessage, AiMessageSchema } from './schemas/ai-message.schema';
import { SalesScenario, SalesScenarioSchema } from './schemas/sales-scenario.schema';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiConversation.name, schema: AiConversationSchema },
      { name: AiMessage.name, schema: AiMessageSchema },
      { name: SalesScenario.name, schema: SalesScenarioSchema },
    ]),
  ],
  providers: [AiChatService],
  controllers: [AiChatController],
})
export class AiChatModule {}
