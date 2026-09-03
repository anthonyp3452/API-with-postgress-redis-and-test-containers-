import Redis from 'ioredis';
import { ICacheAdapter } from '../../domain/ports/cache-adapter.port';

export class RedisCacheAdapter implements ICacheAdapter {
  constructor(private readonly redisClient: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redisClient.get(key);
    if (!data) {
      return null;
    }
    try {
      return JSON.parse(data, (k, v) => {
        // Automatically rehydrate ISO date strings
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
          return new Date(v);
        }
        return v;
      }) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.redisClient.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.redisClient.set(key, serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.redisClient.del(key);
  }

  async flush(): Promise<void> {
    await this.redisClient.flushall();
  }

  async disconnect(): Promise<void> {
    await this.redisClient.quit();
  }
}
