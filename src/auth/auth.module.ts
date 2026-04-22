import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { MongooseModule } from '@nestjs/mongoose';
import { LoginRequest, LoginRequestSchema } from './schemas/login-request.schema';
import { LoginChallenge, LoginChallengeSchema } from './schemas/login-challenge.schema';
import { UsersModule } from '../users/users.module';
import { WorkSettingsModule } from '../work-settings/work-settings.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AutoLogoutService } from './auto-logout.service';

@Module({
  imports: [
    UsersModule,
    WorkSettingsModule,
    PassportModule,
    MongooseModule.forFeature([
      { name: LoginRequest.name, schema: LoginRequestSchema },
      { name: LoginChallenge.name, schema: LoginChallengeSchema }
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, AutoLogoutService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
