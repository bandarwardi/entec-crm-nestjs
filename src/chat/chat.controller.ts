import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';
import { MediaType } from './schemas/message.schema';
import { UploadProxyService } from '../common/upload-proxy.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly uploadProxy: UploadProxyService,
  ) {}

  @Get('conversations')
  async getConversations(@Request() req) {
    return this.chatService.getUserConversations(req.user.userId);
  }

  @Post('conversations')
  async startConversation(@Request() req, @Body('userId') otherUserId: string) {
    return this.chatService.findOrCreateConversation(req.user.userId, otherUserId);
  }

  @Get('conversations/:id/messages')
  async getMessages(
    @Param('id') conversationId: string,
    @Query('before') before: string,
    @Query('limit') limit: string,
    @Request() req,
  ) {
    return this.chatService.getMessages(
      conversationId,
      req.user.userId,
      before,
      limit ? Number(limit) : 15,
    );
  }

  @Patch('conversations/:id/read')
  async markAsRead(@Param('id') conversationId: string, @Request() req) {
    await this.chatService.markAsRead(conversationId, req.user.userId);
    return { success: true };
  }

  @Post('conversations/:id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  )
  async uploadMedia(
    @Param('id') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) {
      throw new BadRequestException('File is missing');
    }

    const mediaUrl = await this.uploadProxy.uploadFile(file);
    const mediaType = file.mimetype.startsWith('image/') ? MediaType.IMAGE : MediaType.FILE;
    const message = await this.chatService.sendMessage(req.user.userId, conversationId, {
      mediaUrl,
      mediaType,
      originalFileName: file.originalname,
    });

    return message;
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Param('id') conversationId: string,
    @Body('content') content: string,
    @Request() req,
  ) {
    return this.chatService.sendMessage(req.user.userId, conversationId, {
      content,
    });
  }
}
