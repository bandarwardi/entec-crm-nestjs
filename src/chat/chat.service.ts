import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Not } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message, MediaType } from './entities/message.entity';
import { User } from '../users/user.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findOrCreateConversation(user1Id: number, user2Id: number): Promise<Conversation> {
    const ids = [user1Id, user2Id].sort((a, b) => a - b);
    const u1 = ids[0];
    const u2 = ids[1];

    let conversation = await this.conversationRepo.findOne({
      where: { user1Id: u1, user2Id: u2 },
      relations: ['user1', 'user2'],
    });

    if (!conversation) {
      const user1 = await this.userRepo.findOne({ where: { id: u1 } });
      const user2 = await this.userRepo.findOne({ where: { id: u2 } });

      if (!user1 || !user2) {
        throw new NotFoundException('أحد المستخدمين غير موجود، تعذر بدء المحادثة');
      }

      conversation = this.conversationRepo.create({
        user1Id: u1,
        user2Id: u2,
      });
      conversation = await this.conversationRepo.save(conversation);
      // Reload relations
      conversation = await this.conversationRepo.findOne({
        where: { id: conversation.id },
        relations: ['user1', 'user2'],
      });
    }

    return conversation!;
  }

  async getUserConversations(userId: number) {
    const conversations = await this.conversationRepo.find({
      where: [{ user1Id: userId }, { user2Id: userId }],
      relations: ['user1', 'user2'],
      order: { lastMessageAt: 'DESC' },
    });

    // Add last message and unread count for each conversation
    const results = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await this.messageRepo.findOne({
          where: { conversationId: conv.id },
          order: { createdAt: 'DESC' },
          relations: ['sender']
        });

        const unreadCount = await this.messageRepo.count({
          where: {
            conversationId: conv.id,
            senderId: userId === conv.user1Id ? conv.user2Id : conv.user1Id,
            isRead: false,
          },
        });

        const otherUser = userId === conv.user1Id ? conv.user2 : conv.user1;

        return {
          id: conv.id,
          user1Id: conv.user1Id,
          user2Id: conv.user2Id,
          lastMessageAt: conv.lastMessageAt,
          createdAt: conv.createdAt,
          otherUser: {
            id: otherUser.id,
            name: otherUser.name,
            email: otherUser.email,
            role: otherUser.role
          },
          lastMessage,
          unreadCount,
        };
      }),
    );

    return results;
  }

  async getMessages(conversationId: number, userId: number, before?: string | Date, limit = 15) {
    const conversation = await this.conversationRepo.findOne({
        where: { id: conversationId }
    });
    if (!conversation) {
        throw new NotFoundException('المحادثة غير موجودة');
    }
    
    if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
        throw new BadRequestException('ليس لديك صلاحية للوصول إلى هذه المحادثة');
    }

    const where: any = { conversationId };
    if (before) {
      where.createdAt = LessThan(new Date(before));
    }

    const messages = await this.messageRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      relations: ['sender'],
    });

    return messages.reverse();
  }

  async sendMessage(senderId: number, conversationId: number, data: { content?: string; mediaUrl?: string; mediaType?: MediaType; originalFileName?: string }) {
    const conversation = await this.conversationRepo.findOne({
        where: { id: conversationId }
    });
    if (!conversation) throw new NotFoundException('المحادثة غير موجودة، لا يمكن إرسال الرسالة');

    if (conversation.user1Id !== senderId && conversation.user2Id !== senderId) {
        throw new BadRequestException('لا يمكنك إرسال رسائل في هذه المحادثة');
    }

    const message = this.messageRepo.create({
      senderId,
      conversationId,
      ...data,
    });

    const savedMessage = await this.messageRepo.save(message);

    // Update last message time
    await this.conversationRepo.update(conversationId, {
      lastMessageAt: savedMessage.createdAt,
    });

    return this.messageRepo.findOne({
        where: { id: savedMessage.id },
        relations: ['sender']
    });
  }

  async markAsRead(conversationId: number, userId: number) {
    await this.messageRepo.update(
      {
        conversationId,
        senderId: Not(userId), // Messages not sent by me
        isRead: false,
      },
      { isRead: true },
    );
  }
}

// I need NotIn from typeorm
