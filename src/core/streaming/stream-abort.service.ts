import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

/**
 * Stream Abort Service
 *
 * Manages stream abort signals across multiple server instances.
 * Uses Redis Pub/Sub for cross-instance communication.
 *
 * In single-instance mode (memory), uses local Map.
 * In multi-instance mode (redis), uses Redis Pub/Sub.
 *
 * This is the ONLY Redis-dependent feature for streaming scalability.
 * Chat history is stored separately via IChatRepository.
 */
@Injectable()
export class StreamAbortService implements OnModuleInit, OnModuleDestroy {
  private localControllers = new Map<string, AbortController>();
  private subscriber: RedisClientType | null = null;
  private publisher: RedisClientType | null = null;
  private isRedisEnabled = false;
  private subscribedChannels = new Set<string>();

  constructor(private configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const provider = this.configService.get('SSE_STREAM_STORE_PROVIDER', 'memory');

    if (provider === 'redis') {
      await this.initializeRedis();
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Clean up all local controllers
    for (const controller of this.localControllers.values()) {
      controller.abort();
    }
    this.localControllers.clear();

    // Close Redis connections
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    if (this.publisher) {
      await this.publisher.quit();
    }
  }

  private async initializeRedis(): Promise<void> {
    const redisUrl = this.configService.get('REDIS_URL', 'redis://localhost:6379');

    try {
      // Create publisher client
      this.publisher = createClient({ url: redisUrl });
      this.publisher.on('error', (err) => console.error('Redis publisher error:', err));
      await this.publisher.connect();

      // Create subscriber client (separate connection required for Pub/Sub)
      this.subscriber = createClient({ url: redisUrl });
      this.subscriber.on('error', (err) => console.error('Redis subscriber error:', err));
      await this.subscriber.connect();

      this.isRedisEnabled = true;
      console.log('StreamAbortService: Redis Pub/Sub enabled for cross-instance abort signals');
    } catch (error) {
      console.warn('StreamAbortService: Failed to connect to Redis, falling back to local-only mode', error);
      this.isRedisEnabled = false;
    }
  }

  /**
   * Register a new stream and get its AbortController
   *
   * @param threadId - The thread/stream identifier
   * @returns AbortController to check/trigger abort
   */
  async registerStream(threadId: string): Promise<AbortController> {
    // Clean up any existing controller for this thread
    const existing = this.localControllers.get(threadId);
    if (existing) {
      existing.abort();
    }

    const controller = new AbortController();
    this.localControllers.set(threadId, controller);

    // If Redis is enabled, subscribe to abort channel for this thread
    if (this.isRedisEnabled && this.subscriber) {
      const channel = this.getAbortChannel(threadId);

      if (!this.subscribedChannels.has(channel)) {
        await this.subscriber.subscribe(channel, () => {
          const ctrl = this.localControllers.get(threadId);
          if (ctrl) {
            ctrl.abort();
            this.localControllers.delete(threadId);
          }
        });
        this.subscribedChannels.add(channel);
      }
    }

    return controller;
  }

  /**
   * Request abort for a stream (works across instances via Redis)
   *
   * @param threadId - The thread/stream identifier
   * @returns true if abort signal was sent
   */
  async requestAbort(threadId: string): Promise<boolean> {
    // Always try local abort first
    const localController = this.localControllers.get(threadId);
    if (localController) {
      localController.abort();
      this.localControllers.delete(threadId);
    }

    // If Redis is enabled, publish abort signal to all instances
    if (this.isRedisEnabled && this.publisher) {
      const channel = this.getAbortChannel(threadId);
      await this.publisher.publish(channel, JSON.stringify({ action: 'abort', timestamp: Date.now() }));
      return true;
    }

    return !!localController;
  }

  /**
   * Unregister a stream when it completes
   *
   * @param threadId - The thread/stream identifier
   */
  async unregisterStream(threadId: string): Promise<void> {
    this.localControllers.delete(threadId);

    // Unsubscribe from Redis channel
    if (this.isRedisEnabled && this.subscriber) {
      const channel = this.getAbortChannel(threadId);
      if (this.subscribedChannels.has(channel)) {
        await this.subscriber.unsubscribe(channel);
        this.subscribedChannels.delete(channel);
      }
    }
  }

  /**
   * Check if a stream is active locally
   */
  isStreamActive(threadId: string): boolean {
    const controller = this.localControllers.get(threadId);
    return controller !== undefined && !controller.signal.aborted;
  }

  /**
   * Get count of active streams on this instance
   */
  getActiveStreamCount(): number {
    return this.localControllers.size;
  }

  /**
   * Check if Redis is connected
   */
  isRedisConnected(): boolean {
    return this.isRedisEnabled;
  }

  private getAbortChannel(threadId: string): string {
    return `sse:abort:${threadId}`;
  }
}
