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
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';
import { MediaType } from './entities/message.entity';
import { existsSync, mkdirSync } from 'fs';

const UPLOAD_PATH = './uploads/chat';
if (!existsSync(UPLOAD_PATH)) {
  mkdirSync(UPLOAD_PATH, { recursive: true });
}

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('conversations')
  async getConversations(@Request() req) {
    return this.chatService.getUserConversations(req.user.userId);
  }

  @Post('conversations')
  async startConversation(@Request() req, @Body('userId') otherUserId: number) {
    return this.chatService.findOrCreateConversation(req.user.userId, otherUserId);
  }

  @Get('conversations/:id/messages')
  async getMessages(
    @Param('id') conversationId: number,
    @Query('before') before: string,
    @Query('limit') limit: number,
    @Request() req,
  ) {
    return this.chatService.getMessages(
      Number(conversationId),
      req.user.userId,
      before,
      limit ? Number(limit) : 15,
    );
  }

  @Patch('conversations/:id/read')
  async markAsRead(@Param('id') conversationId: number, @Request() req) {
    await this.chatService.markAsRead(Number(conversationId), req.user.userId);
    return { success: true };
  }

  @Post('conversations/:id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_PATH,
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${file.fieldname}-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Invalid file type'), false);
        }
      },
    }),
  )
  async uploadMedia(
    @Param('id') conversationId: number,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) {
      throw new BadRequestException('File is missing');
    }

    const mediaType = file.mimetype.startsWith('image/') ? MediaType.IMAGE : MediaType.FILE;
    const mediaUrl = `/uploads/chat/${file.filename}`;

    const message = await this.chatService.sendMessage(req.user.userId, Number(conversationId), {
      mediaUrl,
      mediaType,
      originalFileName: file.originalname,
    });

    return message;
  }
}
