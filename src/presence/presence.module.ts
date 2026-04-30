import { Module, Global } from '@nestjs/common';
import { PresenceGateway } from './presence.gateway';
import { PresenceService } from './presence.service';
import { WsTokenStore } from '../auth/ws-token.store';

import { UsersModule } from '../users/users.module';

@Global()
@Module({
  imports: [UsersModule],
  providers: [PresenceGateway, PresenceService, WsTokenStore],
  exports: [PresenceService, WsTokenStore],
})
export class PresenceModule {}
