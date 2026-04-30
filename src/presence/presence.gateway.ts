import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PresenceService } from './presence.service';
import { WsTokenStore } from '../auth/ws-token.store';

@WebSocketGateway({
  namespace: '/presence',
  cors: {
    origin: '*', // tighten this in production
    credentials: true,
  },
})
export class PresenceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly presenceService: PresenceService,
    private readonly wsTokenStore: WsTokenStore,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    console.log('[PresenceGateway] New connection attempt:', socket.id);
    // Check both auth and query for wsToken
    const wsToken = (socket.handshake.auth?.wsToken || socket.handshake.query?.wsToken) as string;
    console.log('[PresenceGateway] received wsToken:', wsToken);

    if (!wsToken) {
      console.log('[PresenceGateway] No wsToken provided, disconnecting');
      socket.disconnect();
      return;
    }

    const userId = this.wsTokenStore.consume(wsToken);
    console.log('[PresenceGateway] Found userId for token:', userId);

    if (!userId) {
      console.log('[PresenceGateway] Token invalid or expired, disconnecting');
      // Token invalid, expired, or already used
      socket.disconnect();
      return;
    }

    // Attach userId to socket for cleanup on disconnect
    socket.data.userId = userId;
    await this.presenceService.register(userId, socket);
    console.log(`[PresenceGateway] User ${userId} registered successfully`);

    socket.emit('connected', { status: 'ok' });
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    console.log(`[PresenceGateway] Socket ${socket.id} disconnected`);
    await this.presenceService.removeBySocket(socket);
  }
}
