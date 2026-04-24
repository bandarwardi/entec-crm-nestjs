import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';

@Injectable()
export class PresenceService {
  // userId → Set of active socket connections
  private activeConnections = new Map<string, Set<Socket>>();
  // socketId → userId (Reverse mapping for reliable cleanup)
  private socketToUser = new Map<string, string>();

  register(userId: string, socket: Socket): void {
    console.log(`[PresenceService] Registering user: ${userId} (socket: ${socket.id})`);
    
    this.socketToUser.set(socket.id, userId);

    if (!this.activeConnections.has(userId)) {
      this.activeConnections.set(userId, new Set());
    }
    this.activeConnections.get(userId)!.add(socket);
    
    console.log(`[PresenceService] Active users: ${Array.from(this.activeConnections.keys())}`);
  }

  removeBySocket(socket: Socket): void {
    const userId = this.socketToUser.get(socket.id);
    if (!userId) {
      console.log(`[PresenceService] No user found for socket ${socket.id} to remove`);
      return;
    }

    console.log(`[PresenceService] Removing socket ${socket.id} for user ${userId}`);
    this.socketToUser.delete(socket.id);

    const sockets = this.activeConnections.get(userId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.activeConnections.delete(userId);
      }
    }
    console.log(`[PresenceService] Remaining active users: ${Array.from(this.activeConnections.keys())}`);
  }

  isActive(userId: string): boolean {
    const sockets = this.activeConnections.get(userId);
    const active = !!sockets && sockets.size > 0;
    
    console.log(`[PresenceGuard] Check userId: ${userId} | Active: ${active}`);
    console.log(`[PresenceGuard] All Active IDs: ${Array.from(this.activeConnections.keys()).join(', ')}`);
    
    return active;
  }
}
