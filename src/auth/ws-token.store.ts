import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

interface WsTokenEntry {
  userId: string;
  expiresAt: number;
}

@Injectable()
export class WsTokenStore {
  private tokens = new Map<string, WsTokenEntry>();
  private readonly TTL_MS = 30_000; // 30 seconds

  issue(userId: string): string {
    const token = randomUUID();
    this.tokens.set(token, {
      userId,
      expiresAt: Date.now() + this.TTL_MS,
    });
    return token;
  }

  consume(token: string): string | null {
    const entry = this.tokens.get(token);
    this.tokens.delete(token); // delete immediately — one-time use

    if (!entry) return null;
    if (Date.now() > entry.expiresAt) return null;

    return entry.userId;
  }
}
