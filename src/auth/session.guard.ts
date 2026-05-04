import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PresenceService } from '../presence/presence.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly presenceService: PresenceService) {}

  canActivate(context: ExecutionContext): boolean {
    // TEMPORARY BYPASS: Disable session protection
    return true;

    const request = context.switchToHttp().getRequest();

    // 1. Identify Client Type
    const userAgent = request.headers['user-agent'] || '';
    const isMobile = /Dart|Postman|iPhone|Android|Mobile|OKHTTP|CFNetwork/i.test(userAgent);
    
    console.log(`[SessionGuard] Request from: ${userAgent} | isMobile: ${isMobile}`);

    if (isMobile) {
      return true; // Mobile apps bypass desktop presence check
    }

    // 2. Try to get userId from JWT (request.user) or fallback to cookie
    const userId = request.user?.userId || request.cookies?.['crm_user'];
    
    if (!userId) {
       console.log(`[SessionGuard] Blocked: No userId found for Browser/Desktop. UA: ${userAgent}`);
       throw new UnauthorizedException('No active desktop session');
    }

    const isActive = this.presenceService.isActive(userId);
    console.log(`[SessionGuard] Presence check for ${userId}: ${isActive}`);

    if (!isActive) {
      throw new UnauthorizedException('No active desktop session');
    }

    return true;
  }
}
