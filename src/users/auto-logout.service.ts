import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UsersService } from './users.service';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import { UserStatus } from './user-status.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { User } from './user.entity';
import { Role } from './roles.enum';
import { DateTime } from 'luxon';

@Injectable()
export class AutoLogoutService {
  private readonly logger = new Logger(AutoLogoutService.name);

  constructor(
    private usersService: UsersService,
    private workSettingsService: WorkSettingsService,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  // Run every day at 7 AM Cairo time (1 hour after default 6 AM shift end)
  // The cron uses the server time by default, but we can specify the timezone.
  @Cron('0 0 7 * * *', {
    timeZone: 'Africa/Cairo',
  })
  async handleAutoLogout() {
    this.logger.log('Starting scheduled auto-logout for agents...');

    const settings = await this.workSettingsService.getSettings();
    const timezone = settings.timezone || 'Africa/Cairo';
    const now = DateTime.now().setZone(timezone);

    // Get all agents who are not OFFLINE
    const activeAgents = await this.usersRepository.find({
      where: {
        role: Role.AGENT,
        currentStatus: Not(UserStatus.OFFLINE),
      },
    });

    if (activeAgents.length === 0) {
      this.logger.log('No active agents found for auto-logout.');
      return;
    }

    this.logger.log(`Found ${activeAgents.length} agents to log out.`);

    for (const agent of activeAgents) {
      try {
        await this.usersService.updateStatus(
          agent.id,
          UserStatus.OFFLINE,
          undefined,
          'تسجيل خروج تلقائي (انتهاء الدوام)',
        );
        this.logger.log(`Auto-logged out agent: ${agent.name} (ID: ${agent.id})`);
      } catch (error) {
        this.logger.error(`Failed to auto-logout agent ${agent.id}: ${error.message}`);
      }
    }

    this.logger.log('Auto-logout process completed.');
  }
}
