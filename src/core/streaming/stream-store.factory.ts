import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStreamStore } from './types';
import { InMemoryStreamStore } from './stream-store.service';
import { RedisStreamStore } from './redis-stream-store.service';

export type StreamStoreProvider = 'memory' | 'redis';

/**
 * Stream Store Factory
 *
 * Creates the appropriate stream store based on configuration.
 * Allows zero-code switching between memory (dev) and Redis (prod).
 *
 * Environment variable: SSE_STREAM_STORE_PROVIDER
 * - "memory" (default): In-memory store for local development
 * - "redis": Redis-backed store for production (requires REDIS_URL)
 */
@Injectable()
export class StreamStoreFactory {
  constructor(
    private configService: ConfigService,
    private inMemoryStore: InMemoryStreamStore,
    private redisStore: RedisStreamStore,
  ) {}

  /**
   * Get the configured stream store instance
   */
  getStore(): IStreamStore {
    const provider = this.configService.get<StreamStoreProvider>('SSE_STREAM_STORE_PROVIDER', 'memory');

    switch (provider) {
      case 'redis':
        return this.redisStore;
      case 'memory':
      default:
        return this.inMemoryStore;
    }
  }

  /**
   * Get the current provider name
   */
  getProviderName(): StreamStoreProvider {
    return this.configService.get<StreamStoreProvider>('SSE_STREAM_STORE_PROVIDER', 'memory');
  }
}
