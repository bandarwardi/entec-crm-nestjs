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

    // userId is stored in cookie after login
    const userId = request.cookies?.['crm_user'];
    console.log('[SessionGuard] Checking cookie crm_user:', userId);

    if (!userId) {
       console.log('[SessionGuard] No crm_user cookie found');
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
