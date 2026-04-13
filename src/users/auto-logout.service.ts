import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UsersService } from './users.service';
import { WorkSettingsService } from '../work-settings/work-settings.service';
import { UserStatus } from './user-status.enum';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { Role } from './roles.enum';
import { DateTime } from 'luxon';

@Injectable()
export class AutoLogoutService {
  private readonly logger = new Logger(AutoLogoutService.name);

  constructor(
    private usersService: UsersService,
    private workSettingsService: WorkSettingsService,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  // Run every day at 7 AM Cairo time
  @Cron('0 0 7 * * *', {
    timeZone: 'Africa/Cairo',
  })
  async handleAutoLogout() {
    this.logger.log('Starting scheduled auto-logout for agents...');

    const settings = await this.workSettingsService.getSettings();
    const timezone = settings.timezone || 'Africa/Cairo';

    // Get all agents who are not OFFLINE
    const activeAgents = await this.userModel.find({
      role: Role.AGENT,
      currentStatus: { $ne: UserStatus.OFFLINE },
    }).exec();

    if (activeAgents.length === 0) {
      this.logger.log('No active agents found for auto-logout.');
      return;
    }

    this.logger.log(`Found ${activeAgents.length} agents to log out.`);

    for (const agent of activeAgents) {
      try {
        await this.usersService.updateStatus(
          agent._id,
          UserStatus.OFFLINE,
          undefined,
          'تسجيل خروج تلقائي (انتهاء الدوام)',
        );
        this.logger.log(`Auto-logged out agent: ${agent.name} (ID: ${agent._id})`);
      } catch (error) {
        this.logger.error(`Failed to auto-logout agent ${agent._id}: ${error.message}`);
      }
    }

    this.logger.log('Auto-logout process completed.');
  }
}
