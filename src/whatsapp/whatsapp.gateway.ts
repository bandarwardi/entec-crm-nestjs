import { 
  WebSocketGateway, 
  WebSocketServer, 
  SubscribeMessage, 
  OnGatewayConnection, 
  OnGatewayDisconnect 
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'whatsapp',
})
export class WhatsappGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WhatsappGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  sendQrUpdate(sessionId: string, qrCode: string) {
    this.server.emit(`wa:qr:${sessionId}`, { qrCode });
  }

  sendStatusUpdate(sessionId: string, status: string) {
    this.server.emit(`wa:status:${sessionId}`, { status });
  }

  sendNewMessage(sessionId: string, message: any) {
    this.server.emit(`wa:message:${sessionId}`, message);
  }

  @SubscribeMessage('join:session')
  handleJoinSession(client: Socket, sessionId: string) {
    client.join(`session:${sessionId}`);
    this.logger.log(`Client ${client.id} joined session ${sessionId}`);
  }
}
