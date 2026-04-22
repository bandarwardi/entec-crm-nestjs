import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UsersService } from '../users/users.service';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { UserStatus } from '../users/user-status.enum';

@Injectable()
export class AutoLogoutService {
  private readonly logger = new Logger(AutoLogoutService.name);

  constructor(
    private usersService: UsersService,
    private workSettingsService: WorkSettingsService,
    @InjectRedis() private readonly redis: Redis
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleAutoLogout() {
    try {
      const settings = await this.workSettingsService.getSettings();
      if (!settings.securityEnabled) return;

      const now = new Date();
      const delay = settings.autoLogoutDelayMinutes || 60;
      
      const shiftEnd = new Date();
      shiftEnd.setHours(settings.shiftEndHour, settings.shiftEndMinute, 0, 0);
      
      const logoutTime = new Date(shiftEnd.getTime() + delay * 60000);
      
      if (now.getHours() === logoutTime.getHours() && now.getMinutes() === logoutTime.getMinutes()) {
        this.logger.log(`Executing daily auto-logout across the system at ${now.toISOString()}`);
        
        await this.redis.set('global_auto_logout_timestamp', Math.floor(Date.now() / 1000).toString());
        
        const allUsers = await this.usersService.findAll();
        const onlineUsers = allUsers.filter(u => u.currentStatus === UserStatus.ONLINE || u.currentStatus === UserStatus.BREAK);
        
        for (const user of onlineUsers) {
          await this.usersService.updateStatus(user.id, UserStatus.OFFLINE, undefined, 'طرد تلقائي لانتهاء الدوام');
        }
        
        this.logger.log(`Successfully logged out ${onlineUsers.length} users.`);
      }
    } catch (error) {
       // Silent fail outside of logs to prevent crashing the cron loop
       this.logger.error('Error during auto-logout execution', error);
    }
  }
}
