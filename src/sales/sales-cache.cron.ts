import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SalesService } from './sales.service';
import { CacheService } from '../common/cache.service';

@Injectable()
export class SalesCacheCron {
  private readonly logger = new Logger(SalesCacheCron.name);

  constructor(
    private readonly salesService: SalesService,
    private readonly cacheService: CacheService
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    // Only run if Redis is actually connected
    if (!(this.cacheService as any).isConnected()) return;

    this.logger.debug('Starting dashboard cache refresh cron...');
    await this.salesService.refreshDashboardCache();
    this.logger.debug('Dashboard cache refresh completed.');
  }
}
