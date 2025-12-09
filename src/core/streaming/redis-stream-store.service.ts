import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { v7 as uuidv7 } from 'uuid';
import { IStreamStore, StreamSession, StreamChunk } from './types';

/**
 * Redis Stream Store
 *
 * Production-ready stream store using Redis for horizontal scaling.
 * Uses Redis Streams (XADD/XRANGE) for efficient append-only storage.
 *
 * Key structure:
 * - sse:session:{threadId} - Hash storing session metadata
 * - sse:chunks:{threadId} - Stream storing chunks
 *
 * Benefits:
 * - Stateless NestJS instances can scale horizontally
 * - Built-in TTL via Redis EXPIRE
 * - Efficient range queries for resumption
 */
@Injectable()
export class RedisStreamStore implements IStreamStore, OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private isConnected = false;

  private readonly TTL_SECONDS: number;
  private readonly KEY_PREFIX = 'sse';

  constructor(private configService: ConfigService) {
    this.TTL_SECONDS = parseInt(this.configService.get('SSE_REDIS_TTL_SECONDS', '3600'), 10);
  }

  async onModuleInit() {
    const redisUrl = this.configService.get('REDIS_URL', 'redis://localhost:6379');

    this.client = createClient({ url: redisUrl });

    this.client.on('error', (err) => {
      console.error('Redis Stream Store error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      console.log('Redis Stream Store connected');
      this.isConnected = true;
    });

    try {
      await this.client.connect();
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  private sessionKey(threadId: string): string {
    return `${this.KEY_PREFIX}:session:${threadId}`;
  }

  private chunksKey(threadId: string): string {
    return `${this.KEY_PREFIX}:chunks:${threadId}`;
  }

  async initSession(threadId: string): Promise<string> {
    const streamId = uuidv7();
    const now = new Date().toISOString();

    const sessionKey = this.sessionKey(threadId);

    // Store session metadata as hash
    await this.client.hSet(sessionKey, {
      threadId,
      streamId,
      isDone: 'false',
      createdAt: now,
      updatedAt: now,
      chunkCount: '0',
    });

    // Set TTL
    await this.client.expire(sessionKey, this.TTL_SECONDS);

    return streamId;
  }

  async appendChunk(threadId: string, chunk: StreamChunk): Promise<void> {
    const sessionKey = this.sessionKey(threadId);
    const chunksKey = this.chunksKey(threadId);

    // Check if session exists
    const exists = await this.client.exists(sessionKey);
    if (!exists) {
      console.warn(`Redis session not found for threadId: ${threadId}`);
      return;
    }

    // Add chunk to stream
    await this.client.xAdd(chunksKey, '*', {
      agent: chunk.agent,
      content: chunk.content,
      contentType: chunk.contentType,
      timestamp: chunk.timestamp.toISOString(),
    });

    // Update session metadata
    await this.client.hSet(sessionKey, {
      updatedAt: new Date().toISOString(),
    });
    await this.client.hIncrBy(sessionKey, 'chunkCount', 1);

    // Refresh TTL on both keys
    await this.client.expire(sessionKey, this.TTL_SECONDS);
    await this.client.expire(chunksKey, this.TTL_SECONDS);
  }

  async markDone(threadId: string, messageId?: string): Promise<void> {
    const sessionKey = this.sessionKey(threadId);

    const updates: Record<string, string> = {
      isDone: 'true',
      updatedAt: new Date().toISOString(),
    };

    if (messageId) {
      updates.messageId = messageId;
    }

    await this.client.hSet(sessionKey, updates);
  }

  async markError(threadId: string, error: string): Promise<void> {
    const sessionKey = this.sessionKey(threadId);

    await this.client.hSet(sessionKey, {
      isDone: 'true',
      error,
      updatedAt: new Date().toISOString(),
    });
  }

  async getSession(threadId: string): Promise<StreamSession | null> {
    const sessionKey = this.sessionKey(threadId);
    const chunksKey = this.chunksKey(threadId);

    // Get session metadata
    const sessionData = await this.client.hGetAll(sessionKey);
    if (!sessionData || !sessionData.threadId) {
      return null;
    }

    // Get all chunks from stream
    const streamEntries = await this.client.xRange(chunksKey, '-', '+');

    const chunks: StreamChunk[] = streamEntries.map((entry) => ({
      agent: entry.message.agent,
      content: entry.message.content,
      contentType: entry.message.contentType as 'thoughts' | 'final_answer',
      timestamp: new Date(entry.message.timestamp),
    }));

    return {
      threadId: sessionData.threadId,
      streamId: sessionData.streamId,
      chunks,
      isDone: sessionData.isDone === 'true',
      error: sessionData.error,
      createdAt: new Date(sessionData.createdAt),
      updatedAt: new Date(sessionData.updatedAt),
    };
  }

  async getChunksAfter(threadId: string, afterIndex: number): Promise<StreamChunk[]> {
    const chunksKey = this.chunksKey(threadId);

    // Get all entries and slice (Redis Streams don't support offset-based queries easily)
    const streamEntries = await this.client.xRange(chunksKey, '-', '+');

    return streamEntries.slice(afterIndex).map((entry) => ({
      agent: entry.message.agent,
      content: entry.message.content,
      contentType: entry.message.contentType as 'thoughts' | 'final_answer',
      timestamp: new Date(entry.message.timestamp),
    }));
  }

  async cleanup(threadId: string): Promise<void> {
    const sessionKey = this.sessionKey(threadId);
    const chunksKey = this.chunksKey(threadId);

    await this.client.del([sessionKey, chunksKey]);
  }

  /**
   * Health check for Redis connection
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}
