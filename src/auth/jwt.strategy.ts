import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRedis() private readonly redis: Redis
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'defaultSecretKey',
    });
  }

  async validate(payload: any) {
    // Check global involuntary logout timestamp
    const logoutTimestamp = await this.redis.get('global_auto_logout_timestamp');
    if (logoutTimestamp && payload.iat) {
      if (payload.iat < parseInt(logoutTimestamp, 10)) {
        throw new UnauthorizedException('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.');
      }
    }
    return { userId: payload.sub, email: payload.email, role: payload.role, name: payload.name };
  }
}

