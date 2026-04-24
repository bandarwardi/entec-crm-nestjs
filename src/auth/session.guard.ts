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

    // Try to get userId from JWT (request.user) or fallback to cookie
    const userId = request.user?.userId || request.cookies?.['crm_user'];
    console.log('[SessionGuard] Checking userId:', userId);

    if (!userId) {
       console.log('[SessionGuard] No userId found in JWT or cookie');
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
