import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { UserStatus } from '../users/user-status.enum';

@Injectable()
export class PresenceService {
  // userId → Set of active socket connections
  private activeConnections = new Map<string, Set<Socket>>();
  // socketId → userId (Reverse mapping for reliable cleanup)
  private socketToUser = new Map<string, string>();
  // userId → timestamp (Server-side grace period)
  private lastLoginMap = new Map<string, number>();

  constructor(private readonly usersService: UsersService) {}

  recordLogin(userId: string): void {
    this.lastLoginMap.set(userId, Date.now());
  }

  async register(userId: string, socket: Socket): Promise<void> {
    console.log(`[PresenceService] Registering user: ${userId} (socket: ${socket.id})`);
    
    this.socketToUser.set(socket.id, userId);

    if (!this.activeConnections.has(userId)) {
      this.activeConnections.set(userId, new Set());
      // First connection, set user as online in DB
      await this.usersService.updateStatus(userId, UserStatus.ONLINE);
    }
    this.activeConnections.get(userId)!.add(socket);
    
    console.log(`[PresenceService] Active users: ${Array.from(this.activeConnections.keys())}`);
  }

  async removeBySocket(socket: Socket): Promise<void> {
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
        // Last connection closed, set user as offline in DB
        await this.usersService.updateStatus(userId, UserStatus.OFFLINE);
      }
    }
    console.log(`[PresenceService] Remaining active users: ${Array.from(this.activeConnections.keys())}`);
  }

  isActive(userId: string): boolean {
    const sockets = this.activeConnections.get(userId);
    let active = !!sockets && sockets.size > 0;
    
    // Server-side grace period: If not active via WS, check if they just logged in (< 15s ago)
    if (!active) {
      const lastLogin = this.lastLoginMap.get(userId);
      if (lastLogin && (Date.now() - lastLogin < 15000)) {
        console.log(`[PresenceService] User ${userId} is within server-side grace period. Treating as active.`);
        active = true;
      }
    }
    
    console.log(`[PresenceGuard] Check userId: ${userId} | Active: ${active}`);
    return active;
  }
}
