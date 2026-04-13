import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private activeUsers = new Map<string, string>(); // userId -> socketId

  constructor(
    private readonly jwtService: JwtService,
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get('JWT_SECRET'),
      });

      const userId = payload.userId || payload.sub;
      this.activeUsers.set(userId, client.id);
      client.join(`user_${userId}`);
      
      console.log(`User connected: ${userId} (${client.id})`);
    } catch (e) {
      console.log('WS Connection error:', e.message);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.activeUsers.entries()) {
      if (socketId === client.id) {
        this.activeUsers.delete(userId);
        console.log(`User disconnected: ${userId}`);
        break;
      }
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; content?: string; mediaUrl?: string; mediaType?: any; originalFileName?: string },
  ) {
    const userId = this.getUserIdFromSocket(client);
    if (!userId) return;

    const message = await this.chatService.sendMessage(userId, data.conversationId, data);
    
    const conv = await this.chatService.getUserConversations(userId);
    const targetConv = conv.find(c => c.id.toString() === data.conversationId);
    
    if (targetConv) {
        const recipientId = targetConv.otherUser.id;
        console.log(`Emitting newMessage to user_${userId} and user_${recipientId}`);
        // Emit to both sender and recipient rooms
        this.server.to(`user_${userId}`).to(`user_${recipientId}`).emit('newMessage', message);
    } else {
        console.warn(`Conversation ${data.conversationId} not found for message emission`);
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; recipientId: string; isTyping: boolean },
  ) {
    const userId = this.getUserIdFromSocket(client);
    if (!userId) return;

    this.server.to(`user_${data.recipientId}`).emit('userTyping', {
      conversationId: data.conversationId,
      userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; recipientId: string },
  ) {
    const userId = this.getUserIdFromSocket(client);
    if (!userId) return;

    await this.chatService.markAsRead(data.conversationId, userId);
    this.server.to(`user_${data.recipientId}`).emit('messagesRead', {
      conversationId: data.conversationId,
      readBy: userId,
    });
  }

  private getUserIdFromSocket(client: Socket): string | null {
    for (const [userId, socketId] of this.activeUsers.entries()) {
      if (socketId === client.id) return userId;
    }
    return null;
  }
}
