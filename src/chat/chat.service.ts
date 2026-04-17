import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
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

    const results = conversations.map((conv) => {
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
        lastMessage: null, // Comes from Firestore on frontend
        unreadCount: 0,   // Comes from Firestore on frontend
      };
    });

    return results;
  }
}
