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
import { SessionGuard } from '../auth/session.guard';
import { ChatService } from './chat.service';
import { UploadProxyService } from '../common/upload-proxy.service';

export enum MediaType {
  IMAGE = 'image',
  FILE = 'file',
}

@Controller('chat')
@UseGuards(JwtAuthGuard, SessionGuard)
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

    return {
      mediaUrl,
      mediaType,
      originalFileName: file.originalname,
    };
  }
}
