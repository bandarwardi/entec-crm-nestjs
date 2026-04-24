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
    const request = context.switchToHttp().getRequest();

    // 1. Exempt Mobile App & Postman (Development)
    const userAgent = request.headers['user-agent'] || '';
    const isMobile = /Dart|Postman|iPhone|Android|Mobile/i.test(userAgent);
    
    if (isMobile) {
      return true;
    }

    // 2. Try to get userId from JWT (request.user) or fallback to cookie
    const userId = request.user?.userId || request.cookies?.['crm_user'];
    
    if (!userId) {
       console.log(`[SessionGuard] Access Denied: No userId for ${userAgent}`);
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
