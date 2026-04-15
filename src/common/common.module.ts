import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { UploadProxyService } from './upload-proxy.service';

@Global()
@Module({
  providers: [CacheService, UploadProxyService],
  exports: [CacheService, UploadProxyService],
})
export class CommonModule {}
