import { Module, MiddlewareConsumer, RequestMethod, NestModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from '@nestjs-modules/ioredis';
import { CommonModule } from './common/common.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { SalesModule } from './sales/sales.module';
import { ChatModule } from './chat/chat.module';
import { AiChatModule } from './ai-chat/ai-chat.module';
import { WorkSettingsModule } from './work-settings/work-settings.module';
import { EmailModule } from './email/email.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { FirebaseModule } from './firebase/firebase.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { BullModule } from '@nestjs/bullmq';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        if (url) {
          try {
            const parsedUrl = new URL(url);
            return {
              connection: {
                host: parsedUrl.hostname,
                port: parseInt(parsedUrl.port) || 6379,
                password: parsedUrl.password || undefined,
              },
            };
          } catch (e) {
            // Fallback if URL parsing fails
          }
        }
        return {
          connection: {
            host: configService.get('REDIS_HOST') || 'localhost',
            port: parseInt(configService.get('REDIS_PORT')!) || 6379,
            password: configService.get('REDIS_PASSWORD'),
          },
        };
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'admin', 'dist', 'sakai-ng', 'browser'),
    }),
    PresenceModule,
    AuthModule,
    UsersModule,
    LeadsModule,
    SalesModule,
    ChatModule,
    AiChatModule,
    WorkSettingsModule,
    EmailModule,
    WhatsappModule,
    FirebaseModule,
    NotificationsModule,
    DashboardModule,
    AuditLogModule,
    CommonModule,
    ScheduleModule.forRoot(),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        if (url) {
          return {
            type: 'single',
            url: url,
          };
        }
        return {
          type: 'single',
          url: `redis://${configService.get('REDIS_HOST') || 'localhost'}:${configService.get('REDIS_PORT') || 6379}`,
          options: {
            password: configService.get('REDIS_PASSWORD'),
          },
        };
      },
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Gateway Disabled
  }
}
