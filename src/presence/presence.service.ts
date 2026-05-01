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
  // userId → expiration timestamp (persistent bypass sessions)
  private managerBypassUsers = new Map<string, number>();

  private readonly BYPASS_TTL = 10 * 60 * 1000; // 10 minutes TTL for bypass sessions

  constructor(private readonly usersService: UsersService) {}

  recordLogin(userId: string, isManagerBypass: boolean = false): void {
    this.lastLoginMap.set(userId, Date.now());
    if (isManagerBypass) {
      this.registerManagerBypass(userId);
    }
  }

  registerManagerBypass(userId: string): void {
    // Set expiration to 10 minutes from now
    this.managerBypassUsers.set(userId, Date.now() + this.BYPASS_TTL);
    this.logger.log(`[Presence] User ${userId} registered/refreshed for Manager Bypass (TTL: 10m)`);
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
        await this.usersService.updateStatus(userId, UserStatus.OFFLINE);
        changed = true;
      }
    }
    return changed ? { status: UserStatus.OFFLINE, userId } : null;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupStaleStatuses() {
    this.logger.log('[Presence] Running scheduled status synchronization...');
    
    // 1. Cleanup expired bypass sessions
    const now = Date.now();
    for (const [userId, expiresAt] of this.managerBypassUsers.entries()) {
      if (now > expiresAt) {
        this.managerBypassUsers.delete(userId);
        this.logger.log(`[Presence] Manager Bypass session expired for user ${userId}`);
      }
    }

    // 2. Cleanup users marked online in DB but having no active sockets/bypass
    const onlineUsers = await this.usersService.findAllOnline();
    for (const user of onlineUsers) {
      const userId = user.id.toString();
      const hasSockets = this.activeConnections.has(userId);
      const isBypass = this.managerBypassUsers.has(userId);

      if (!hasSockets && !isBypass) {
        this.logger.warn(`User ${user.name} (${userId}) marked as online but no active presence. Fixing...`);
        await this.usersService.updateStatus(user.id, UserStatus.OFFLINE);
      }
    }
  }

  isActive(userId: string): boolean {
    const sockets = this.activeConnections.get(userId);
    let active = !!sockets && sockets.size > 0;
    
    if (!active) {
      const lastLogin = this.lastLoginMap.get(userId);
      if (lastLogin && (Date.now() - lastLogin < 15000)) {
        active = true;
      }
    }

    // Manager Bypass: Check if session is still valid (not expired)
    if (!active) {
      const expiresAt = this.managerBypassUsers.get(userId);
      if (expiresAt && Date.now() < expiresAt) {
        active = true;
      }
    }
    
    return active;
  }
}
