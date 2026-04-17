import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { Message, MessageDocument, MediaType } from './schemas/message.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async findOrCreateConversation(user1Id: string, user2Id: string): Promise<ConversationDocument> {
    const ids = [user1Id, user2Id].sort();
    const u1 = ids[0];
    const u2 = ids[1];

    let conversation = await this.conversationModel.findOne({
      user1: new Types.ObjectId(u1),
      user2: new Types.ObjectId(u2)
    }).populate('user1 user2').exec();

    if (!conversation) {
      const user1 = await this.userModel.findById(u1).exec();
      const user2 = await this.userModel.findById(u2).exec();

      if (!user1 || !user2) {
        throw new NotFoundException('أحد المستخدمين غير موجود، تعذر بدء المحادثة');
      }

      conversation = new this.conversationModel({
        user1: new Types.ObjectId(u1),
        user2: new Types.ObjectId(u2),
      });
      await conversation.save();
      
      // Populate and return
      conversation = await this.conversationModel.findById(conversation._id).populate('user1 user2').exec();
    }

    return conversation!;
  }

  async getUserConversations(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const conversations = await this.conversationModel.find({
      $or: [{ user1: userObjectId }, { user2: userObjectId }]
    })
    .populate('user1 user2')
    .sort({ lastMessageAt: -1 })
    .exec();

    const results = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await this.messageModel.findOne({
          conversation: conv._id
        })
        .sort({ createdAt: -1 })
        .populate('sender')
        .exec();

        const otherUserId = userId === conv.user1._id.toString() ? conv.user2._id : conv.user1._id;
        
        const unreadCount = await this.messageModel.countDocuments({
          conversation: conv._id,
          sender: otherUserId,
          isRead: false,
        }).exec();

        const otherUser = userId === conv.user1._id.toString() ? conv.user2 : conv.user1;

        return {
          id: (conv as any)._id,
          user1Id: (conv as any).user1._id,
          user2Id: (conv as any).user2._id,
          lastMessageAt: conv.lastMessageAt,
          createdAt: (conv as any).createdAt,
          otherUser: {
            id: (otherUser as any)._id,
            name: (otherUser as any).name,
            email: (otherUser as any).email,
            role: (otherUser as any).role
          },
          lastMessage,
          unreadCount,
        };
      }),
    );

    return results;
  }

  async getMessages(conversationId: string, userId: string, before?: string | Date, limit = 15) {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) {
        throw new NotFoundException('المحادثة غير موجودة');
    }
    
    if (conversation.user1.toString() !== userId && conversation.user2.toString() !== userId) {
        throw new BadRequestException('ليس لديك صلاحية للوصول إلى هذه المحادثة');
    }

    const filter: any = { conversation: new Types.ObjectId(conversationId) };
    if (before) {
      filter.createdAt = { $lt: new Date(before) };
    }

    const messages = await this.messageModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender')
      .exec();

    return messages.reverse();
  }

  async sendMessage(senderId: string, conversationId: string, data: { content?: string; mediaUrl?: string; mediaType?: MediaType; originalFileName?: string }) {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) throw new NotFoundException('المحادثة غير موجودة، لا يمكن إرسال الرسالة');

    if (conversation.user1.toString() !== senderId && conversation.user2.toString() !== senderId) {
        throw new BadRequestException('لا يمكنك إرسال رسائل في هذه المحادثة');
    }

    const message = new this.messageModel({
      sender: new Types.ObjectId(senderId),
      conversation: new Types.ObjectId(conversationId),
      ...data,
    });

    const savedMessage = await message.save();

    // Update last message time
    await this.conversationModel.findByIdAndUpdate(conversationId, {
      lastMessageAt: savedMessage.createdAt,
    }).exec();

    return this.messageModel.findById(savedMessage._id)
        .populate('sender')
        .exec();
  }

  async markAsRead(conversationId: string, userId: string) {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) return;

    if (conversation.user1.toString() === conversation.user2.toString()) {
      await this.messageModel.updateMany(
        {
          conversation: new Types.ObjectId(conversationId),
          isRead: false,
        },
        { isRead: true },
      ).exec();
    } else {
      await this.messageModel.updateMany(
        {
          conversation: new Types.ObjectId(conversationId),
          sender: { $ne: new Types.ObjectId(userId) },
          isRead: false,
        },
        { isRead: true },
      ).exec();
    }
  }
}
