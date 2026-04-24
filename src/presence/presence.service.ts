import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';

@Injectable()
export class PresenceService {
  // userId → Set of active socket connections
  // A user can have multiple connections (e.g. two machines)
  private activeConnections = new Map<string, Set<Socket>>();

  register(userId: string, socket: Socket): void {
    console.log(`[PresenceService] Registering user: ${userId}`);
    if (!this.activeConnections.has(userId)) {
      this.activeConnections.set(userId, new Set());
    }
    this.activeConnections.get(userId)!.add(socket);
    console.log(`[PresenceService] Active users: ${Array.from(this.activeConnections.keys())}`);
  }

  remove(userId: string, socket: Socket): void {
    const sockets = this.activeConnections.get(userId);
    if (!sockets) return;

    sockets.delete(socket);

    if (sockets.size === 0) {
      this.activeConnections.delete(userId);
    }
  }

  isActive(userId: string): boolean {
    const sockets = this.activeConnections.get(userId);
    return !!sockets && sockets.size > 0;
  }
}
