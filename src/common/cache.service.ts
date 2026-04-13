import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class CacheService {
  constructor(@InjectRedis() private readonly redis: Redis) {
    this.redis.on('connect', () => {
      console.log('✅ Connected to Redis successfully');
    });

    this.redis.on('error', (err) => {
      // Intentionally silences errors to prevent terminal spam
      // The app will continue working by falling back to DB
    });
  }

  private isConnected(): boolean {
    return this.redis.status === 'ready';
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected()) return null;
    try {
      const data = await this.redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (e) {
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected()) return;
    try {
      const data = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.set(key, data, 'EX', ttlSeconds);
      } else {
        await this.redis.set(key, data);
      }
    } catch (e) {
      // Ignore cache set errors
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isConnected()) return;
    try {
      await this.redis.del(key);
    } catch (e) {
      // Ignore cache delete errors
    }
  }

  async invalidateByPattern(pattern: string): Promise<void> {
    if (!this.isConnected()) return;
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (e) {
      // Ignore invalidation errors
    }
  }
}
