import { IStreamStore, StreamChunk, StreamSession } from './types';
import { Injectable, OnModuleDestroy } from '@nestjs/common';

import { v7 as uuidv7 } from 'uuid';

/**
 * In-Memory Stream Store
 *
 * Stores stream chunks for resumption support.
 * In production, replace with Redis implementation for HA.
 *
 * Features:
 * - Auto-merges consecutive chunks from same agent
 * - TTL-based cleanup
 * - Thread-safe operations
 */
@Injectable()
export class InMemoryStreamStore implements IStreamStore, OnModuleDestroy {
  private sessions = new Map<string, StreamSession>();
  private ttlTimers = new Map<string, NodeJS.Timeout>();

  // Default TTL: 1 hour
  private readonly TTL_MS = parseInt(process.env.SSE_STREAM_TTL_MS || '3600000', 10);

  onModuleDestroy() {
    // Clean up all timers on shutdown
    for (const timer of this.ttlTimers.values()) {
      clearTimeout(timer);
    }
    this.ttlTimers.clear();
    this.sessions.clear();
  }

  async initSession(threadId: string): Promise<string> {
    const streamId = uuidv7();
    const now = new Date();

    const session: StreamSession = {
      threadId,
      streamId,
      chunks: [],
      isDone: false,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(threadId, session);
    this.scheduleTTL(threadId);

    return streamId;
  }

  async appendChunk(threadId: string, chunk: StreamChunk): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) {
      console.warn(`Stream session not found for threadId: ${threadId}`);
      return;
    }

    // Merge consecutive chunks from the same agent with same content type
    const lastChunk = session.chunks[session.chunks.length - 1];
    if (lastChunk && lastChunk.agent === chunk.agent && lastChunk.contentType === chunk.contentType) {
      // Append content to existing chunk
      lastChunk.content += chunk.content;
      lastChunk.timestamp = chunk.timestamp;
    } else {
      // Add new chunk
      session.chunks.push({ ...chunk });
    }

    session.updatedAt = new Date();
    this.refreshTTL(threadId);
  }

  async markDone(threadId: string, messageId?: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;

    session.isDone = true;
    session.updatedAt = new Date();

    // Store message ID if provided (for reference to persisted message)
    if (messageId) {
      (session as any).messageId = messageId;
    }
  }

  async markError(threadId: string, error: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;

    session.isDone = true;
    session.error = error;
    session.updatedAt = new Date();
  }

  async getSession(threadId: string): Promise<StreamSession | null> {
    return this.sessions.get(threadId) || null;
  }

  async getChunksAfter(threadId: string, afterIndex: number): Promise<StreamChunk[]> {
    const session = this.sessions.get(threadId);
    if (!session) return [];

    return session.chunks.slice(afterIndex);
  }

  async cleanup(threadId: string): Promise<void> {
    this.sessions.delete(threadId);

    const timer = this.ttlTimers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.ttlTimers.delete(threadId);
    }
  }

  /**
   * Get all active session IDs (for debugging/monitoring)
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get session count (for monitoring)
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  private scheduleTTL(threadId: string): void {
    // Clear existing timer if any
    const existingTimer = this.ttlTimers.get(threadId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.cleanup(threadId);
    }, this.TTL_MS);

    // Don't prevent process exit
    timer.unref();
    this.ttlTimers.set(threadId, timer);
  }

  private refreshTTL(threadId: string): void {
    // Reschedule TTL on activity
    this.scheduleTTL(threadId);
  }
}
