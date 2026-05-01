import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { UserStatus } from '../users/user-status.enum';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  // userId → Set of active socket connections
  private activeConnections = new Map<string, Set<Socket>>();
  // socketId → userId (Reverse mapping for reliable cleanup)
  private socketToUser = new Map<string, string>();
  // userId → timestamp (Server-side grace period)
  private lastLoginMap = new Map<string, number>();
  // userId → Set of manager-bypass tokens (persistent sessions)
  private managerBypassUsers = new Set<string>();

  constructor(private readonly usersService: UsersService) {}

  recordLogin(userId: string, isManagerBypass: boolean = false): void {
    this.lastLoginMap.set(userId, Date.now());
    if (isManagerBypass) {
      this.managerBypassUsers.add(userId);
      this.logger.log(`[Presence] User ${userId} marked as Manager Bypass`);
    }
  }

  clearManagerBypass(userId: string): void {
    this.managerBypassUsers.delete(userId);
  }

  async register(userId: string, socket: Socket): Promise<{ status: UserStatus; userId: string } | null> {
    this.logger.log(`Registering user: ${userId} (socket: ${socket.id})`);
    
    this.socketToUser.set(socket.id, userId);

    let changed = false;
    if (!this.activeConnections.has(userId)) {
      this.activeConnections.set(userId, new Set());
      // First connection, set user as online in DB
      await this.usersService.updateStatus(userId, UserStatus.ONLINE);
      changed = true;
    }
    this.activeConnections.get(userId)!.add(socket);
    
    return changed ? { status: UserStatus.ONLINE, userId } : null;
  }

  async removeBySocket(socket: Socket): Promise<{ status: UserStatus; userId: string } | null> {
    const userId = this.socketToUser.get(socket.id);
    if (!userId) return null;

    this.logger.log(`Removing socket ${socket.id} for user ${userId}`);
    this.socketToUser.delete(socket.id);

    let changed = false;
    const sockets = this.activeConnections.get(userId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.activeConnections.delete(userId);
        // Last connection closed, set user as offline in DB
        await this.usersService.updateStatus(userId, UserStatus.OFFLINE);
        changed = true;
      }
    }
    return changed ? { status: UserStatus.OFFLINE, userId } : null;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupStaleStatuses() {
    this.logger.log('[Presence] Running scheduled status synchronization...');
    // Get all users marked as ONLINE or BUSY or BREAK in DB
    const onlineUsers = await this.usersService.findAllOnline();
    
    for (const user of onlineUsers) {
      if (!this.activeConnections.has(user.id.toString())) {
        this.logger.warn(`User ${user.name} (${user.id}) marked as online but has no active socket. Fixing...`);
        await this.usersService.updateStatus(user.id, UserStatus.OFFLINE);
      }
    }
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

    // Manager Bypass: If user is marked as manager bypass, they are always active
    if (!active && this.managerBypassUsers.has(userId)) {
      console.log(`[PresenceService] User ${userId} is a Manager Bypass session. Treating as active.`);
      active = true;
    }
    
    console.log(`[PresenceGuard] Check userId: ${userId} | Active: ${active}`);
    return active;
  }
}
