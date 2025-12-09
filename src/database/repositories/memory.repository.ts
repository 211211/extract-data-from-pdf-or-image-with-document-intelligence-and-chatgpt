import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import {
  IChatRepository,
  ChatThread,
  ChatMessageEntity,
  ThreadQueryOptions,
  MessageQueryOptions,
  PaginatedResult,
  UpdateResult,
  UpdateOptions,
  ENTITY_TYPES,
  PAGINATION_DEFAULTS,
  ConflictError,
} from '../types';
import { v7 as uuidv7, v4 as uuidv4 } from 'uuid';

/**
 * In-Memory Chat Repository
 *
 * Enterprise-grade in-memory implementation for development and demos.
 * Implements the same patterns as production (CosmosDB):
 * - Optimistic concurrency control (ETags)
 * - Soft deletes
 * - Continuation token pagination
 * - Version-based cache invalidation
 *
 * Use cases:
 * - Local development
 * - Quick demos
 * - Unit testing
 * - GitHub showcase (just clone & run)
 */
@Injectable()
export class InMemoryChatRepository implements IChatRepository, OnModuleDestroy {
  private readonly logger = new Logger(InMemoryChatRepository.name);

  // Primary storage
  private threads = new Map<string, ChatThread>();
  private messages = new Map<string, ChatMessageEntity>();
  private threadMessages = new Map<string, string[]>(); // threadId -> messageIds (ordered)

  // Version tracking for cache invalidation
  private threadVersions = new Map<string, number>();
  private userThreadVersions = new Map<string, number>(); // userId -> version

  // Optional TTL cleanup
  private cleanupTimer?: NodeJS.Timeout;
  private readonly TTL_MS = parseInt(process.env.DATABASE_MEMORY_TTL_MS || '0', 10);

  constructor() {
    if (this.TTL_MS > 0) {
      this.startCleanupTimer();
    }
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  // -------------------------------------------------------------------------
  // Thread Operations
  // -------------------------------------------------------------------------

  async createThread(
    thread: Pick<ChatThread, 'id' | 'userId' | 'title' | 'metadata' | 'isBookmarked' | 'traceId'>,
  ): Promise<ChatThread> {
    const now = new Date();
    const id = thread.id || uuidv7();
    const etag = this.generateEtag();

    const fullThread: ChatThread = {
      id,
      type: ENTITY_TYPES.CHAT_THREAD,
      userId: thread.userId,
      title: thread.title,
      metadata: thread.metadata,
      isBookmarked: thread.isBookmarked ?? false,
      traceId: thread.traceId,
      createdAt: now,
      lastModifiedAt: now,
      isDeleted: false,
      _etag: etag,
      _version: 1,
    };

    this.threads.set(id, fullThread);
    this.threadMessages.set(id, []);
    this.threadVersions.set(id, 1);

    // Increment user's thread list version (cache invalidation)
    this.incrementUserVersion(thread.userId);

    this.logger.debug(`Created thread ${id} for user ${thread.userId}`);
    return fullThread;
  }

  async getThread(threadId: string, includeDeleted = false): Promise<ChatThread | null> {
    const thread = this.threads.get(threadId);
    if (!thread) return null;
    if (!includeDeleted && thread.isDeleted) return null;
    return thread;
  }

  async updateThread(
    threadId: string,
    updates: Partial<Pick<ChatThread, 'title' | 'metadata' | 'isBookmarked'>>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<ChatThread>> {
    const thread = this.threads.get(threadId);
    if (!thread || thread.isDeleted) {
      return { success: false, error: 'Thread not found' };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== thread._etag) {
      if (options.retryOnConflict !== false) {
        // Single automatic retry with fresh data
        return this.updateThread(threadId, updates, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    const newEtag = this.generateEtag();
    const updated: ChatThread = {
      ...thread,
      ...updates,
      metadata: { ...thread.metadata, ...updates.metadata },
      lastModifiedAt: new Date(),
      _etag: newEtag,
      _version: (thread._version || 0) + 1,
    };

    this.threads.set(threadId, updated);
    this.incrementThreadVersion(threadId);
    this.incrementUserVersion(thread.userId);

    return { success: true, entity: updated, newEtag };
  }

  async deleteThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<void>> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return { success: false, error: 'Thread not found' };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== thread._etag) {
      if (options.retryOnConflict !== false) {
        return this.deleteThread(threadId, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    // Soft delete
    const newEtag = this.generateEtag();
    thread.isDeleted = true;
    thread.lastModifiedAt = new Date();
    thread._etag = newEtag;
    thread._version = (thread._version || 0) + 1;

    this.incrementUserVersion(thread.userId);

    this.logger.debug(`Soft deleted thread ${threadId}`);
    return { success: true, newEtag };
  }

  async hardDeleteThread(threadId: string): Promise<boolean> {
    const thread = this.threads.get(threadId);
    if (!thread) return false;

    // Delete all messages in thread
    const messageIds = this.threadMessages.get(threadId) || [];
    for (const msgId of messageIds) {
      this.messages.delete(msgId);
    }

    this.threadMessages.delete(threadId);
    this.threads.delete(threadId);
    this.threadVersions.delete(threadId);
    this.incrementUserVersion(thread.userId);

    this.logger.debug(`Hard deleted thread ${threadId} with ${messageIds.length} messages`);
    return true;
  }

  async restoreThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<ChatThread>> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return { success: false, error: 'Thread not found' };
    }

    if (!thread.isDeleted) {
      return { success: true, entity: thread };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== thread._etag) {
      if (options.retryOnConflict !== false) {
        return this.restoreThread(threadId, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    const newEtag = this.generateEtag();
    thread.isDeleted = false;
    thread.lastModifiedAt = new Date();
    thread._etag = newEtag;
    thread._version = (thread._version || 0) + 1;

    this.incrementUserVersion(thread.userId);

    this.logger.debug(`Restored thread ${threadId}`);
    return { success: true, entity: thread, newEtag };
  }

  async listThreads(options?: ThreadQueryOptions): Promise<PaginatedResult<ChatThread>> {
    let threads = Array.from(this.threads.values());

    // Filter by userId (partition key in production)
    if (options?.userId) {
      threads = threads.filter((t) => t.userId === options.userId);
    }

    // Filter soft deleted
    if (!options?.includeDeleted) {
      threads = threads.filter((t) => !t.isDeleted);
    }

    // Filter by bookmark
    if (options?.isBookmarked !== undefined) {
      threads = threads.filter((t) => t.isBookmarked === options.isBookmarked);
    }

    // Sort (aligned with composite indexes)
    const sortBy = options?.sortBy || 'lastModifiedAt';
    const sortOrder = options?.sortOrder || 'desc';
    threads.sort((a, b) => {
      const aVal = a[sortBy].getTime();
      const bVal = b[sortBy].getTime();
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

    // Pagination with continuation token
    const limit = Math.min(
      options?.limit || PAGINATION_DEFAULTS.THREADS_PAGE_SIZE,
      PAGINATION_DEFAULTS.THREADS_PAGE_SIZE_MAX,
    );

    let startIndex = 0;
    if (options?.continuationToken) {
      startIndex = this.decodeContinuationToken(options.continuationToken);
    } else if (options?.offset) {
      startIndex = options.offset;
    }

    const paginatedThreads = threads.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < threads.length;

    return {
      items: paginatedThreads,
      continuationToken: hasMore ? this.encodeContinuationToken(startIndex + limit) : undefined,
      hasMore,
      totalCount: threads.length,
    };
  }

  async touchThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<ChatThread>> {
    return this.updateThread(threadId, {}, options);
  }

  // -------------------------------------------------------------------------
  // Message Operations
  // -------------------------------------------------------------------------

  async upsertMessage(
    message: Pick<ChatMessageEntity, 'id' | 'threadId' | 'userId' | 'role' | 'content' | 'metadata'>,
  ): Promise<ChatMessageEntity> {
    const id = message.id || uuidv7();
    const existing = this.messages.get(id);
    const now = new Date();
    const etag = this.generateEtag();

    const fullMessage: ChatMessageEntity = {
      id,
      type: ENTITY_TYPES.CHAT_MESSAGE,
      threadId: message.threadId,
      userId: message.userId,
      role: message.role,
      content: message.content,
      metadata: message.metadata,
      createdAt: existing?.createdAt || now,
      lastModifiedAt: now,
      isDeleted: false,
      _etag: etag,
      _version: existing ? (existing._version || 0) + 1 : 1,
    };

    this.messages.set(id, fullMessage);

    // Track message in thread if new
    if (!existing) {
      const threadMsgs = this.threadMessages.get(message.threadId) || [];
      threadMsgs.push(id);
      this.threadMessages.set(message.threadId, threadMsgs);
    }

    // Update thread's lastModifiedAt (moves to top of list)
    const thread = this.threads.get(message.threadId);
    if (thread && !thread.isDeleted) {
      thread.lastModifiedAt = now;
      thread._version = (thread._version || 0) + 1;
      this.incrementThreadVersion(message.threadId);
      this.incrementUserVersion(thread.userId);
    }

    return fullMessage;
  }

  async getMessage(messageId: string, includeDeleted = false): Promise<ChatMessageEntity | null> {
    const message = this.messages.get(messageId);
    if (!message) return null;
    if (!includeDeleted && message.isDeleted) return null;
    return message;
  }

  async getMessages(threadId: string, options?: MessageQueryOptions): Promise<PaginatedResult<ChatMessageEntity>> {
    const messageIds = this.threadMessages.get(threadId) || [];
    let messages = messageIds.map((id) => this.messages.get(id)).filter((m): m is ChatMessageEntity => m !== undefined);

    // Filter soft deleted
    if (!options?.includeDeleted) {
      messages = messages.filter((m) => !m.isDeleted);
    }

    // Filter by role
    if (options?.role) {
      messages = messages.filter((m) => m.role === options.role);
    }

    // Sort by createdAt ascending (conversation order)
    messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Pagination with continuation token
    const limit = Math.min(
      options?.limit || PAGINATION_DEFAULTS.MESSAGES_PAGE_SIZE,
      PAGINATION_DEFAULTS.MESSAGES_PAGE_SIZE_MAX,
    );

    let startIndex = 0;
    if (options?.continuationToken) {
      startIndex = this.decodeContinuationToken(options.continuationToken);
    } else if (options?.offset) {
      startIndex = options.offset;
    }

    const paginatedMessages = messages.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < messages.length;

    return {
      items: paginatedMessages,
      continuationToken: hasMore ? this.encodeContinuationToken(startIndex + limit) : undefined,
      hasMore,
      totalCount: messages.length,
    };
  }

  async updateMessage(
    messageId: string,
    updates: Partial<Pick<ChatMessageEntity, 'content' | 'metadata'>>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<ChatMessageEntity>> {
    const message = this.messages.get(messageId);
    if (!message || message.isDeleted) {
      return { success: false, error: 'Message not found' };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== message._etag) {
      if (options.retryOnConflict !== false) {
        return this.updateMessage(messageId, updates, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    const newEtag = this.generateEtag();
    const updated: ChatMessageEntity = {
      ...message,
      ...updates,
      metadata: { ...message.metadata, ...updates.metadata },
      lastModifiedAt: new Date(),
      _etag: newEtag,
      _version: (message._version || 0) + 1,
    };

    this.messages.set(messageId, updated);

    return { success: true, entity: updated, newEtag };
  }

  async deleteMessage(messageId: string, options?: UpdateOptions): Promise<UpdateResult<void>> {
    const message = this.messages.get(messageId);
    if (!message) {
      return { success: false, error: 'Message not found' };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== message._etag) {
      if (options.retryOnConflict !== false) {
        return this.deleteMessage(messageId, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    // Soft delete
    const newEtag = this.generateEtag();
    message.isDeleted = true;
    message.lastModifiedAt = new Date();
    message._etag = newEtag;
    message._version = (message._version || 0) + 1;

    return { success: true, newEtag };
  }

  async hardDeleteMessage(messageId: string): Promise<boolean> {
    const message = this.messages.get(messageId);
    if (!message) return false;

    // Remove from thread's message list
    const threadMsgs = this.threadMessages.get(message.threadId) || [];
    const index = threadMsgs.indexOf(messageId);
    if (index > -1) {
      threadMsgs.splice(index, 1);
    }

    this.messages.delete(messageId);
    return true;
  }

  async countMessages(threadId: string, includeDeleted = false): Promise<number> {
    const messageIds = this.threadMessages.get(threadId) || [];
    if (includeDeleted) {
      return messageIds.length;
    }
    return messageIds.filter((id) => {
      const msg = this.messages.get(id);
      return msg && !msg.isDeleted;
    }).length;
  }

  async getLastMessage(threadId: string): Promise<ChatMessageEntity | null> {
    const messageIds = this.threadMessages.get(threadId) || [];
    for (let i = messageIds.length - 1; i >= 0; i--) {
      const msg = this.messages.get(messageIds[i]);
      if (msg && !msg.isDeleted) {
        return msg;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Batch Operations
  // -------------------------------------------------------------------------

  async bulkUpsertMessages(messages: ChatMessageEntity[]): Promise<ChatMessageEntity[]> {
    const results: ChatMessageEntity[] = [];
    for (const msg of messages) {
      const result = await this.upsertMessage(msg);
      results.push(result);
    }
    return results;
  }

  async bulkDeleteMessages(threadId: string): Promise<number> {
    const messageIds = this.threadMessages.get(threadId) || [];
    let count = 0;
    for (const id of messageIds) {
      const msg = this.messages.get(id);
      if (msg && !msg.isDeleted) {
        msg.isDeleted = true;
        msg.lastModifiedAt = new Date();
        msg._version = (msg._version || 0) + 1;
        count++;
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Cache Support
  // -------------------------------------------------------------------------

  async getThreadVersion(threadId: string): Promise<number> {
    return this.threadVersions.get(threadId) || 0;
  }

  async incrementThreadVersion(threadId: string): Promise<number> {
    const current = this.threadVersions.get(threadId) || 0;
    const newVersion = current + 1;
    this.threadVersions.set(threadId, newVersion);
    return newVersion;
  }

  getUserVersion(userId: string): number {
    return this.userThreadVersions.get(userId) || 0;
  }

  private incrementUserVersion(userId: string): void {
    const current = this.userThreadVersions.get(userId) || 0;
    this.userThreadVersions.set(userId, current + 1);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    this.logger.log('InMemoryChatRepository initialized');
  }

  async close(): Promise<void> {
    this.threads.clear();
    this.messages.clear();
    this.threadMessages.clear();
    this.threadVersions.clear();
    this.userThreadVersions.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.logger.log('InMemoryChatRepository closed');
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  // -------------------------------------------------------------------------
  // Debug/Monitoring
  // -------------------------------------------------------------------------

  getStats(): { threadCount: number; messageCount: number; deletedThreads: number; deletedMessages: number } {
    let deletedThreads = 0;
    let deletedMessages = 0;

    for (const thread of this.threads.values()) {
      if (thread.isDeleted) deletedThreads++;
    }
    for (const msg of this.messages.values()) {
      if (msg.isDeleted) deletedMessages++;
    }

    return {
      threadCount: this.threads.size - deletedThreads,
      messageCount: this.messages.size - deletedMessages,
      deletedThreads,
      deletedMessages,
    };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private generateEtag(): string {
    // Use UUIDv4 for ETags - random/opaque identifiers (not time-ordered like UUIDv7)
    return `"${uuidv4()}"`;
  }

  private encodeContinuationToken(offset: number): string {
    return Buffer.from(JSON.stringify({ offset, ts: Date.now() })).toString('base64');
  }

  private decodeContinuationToken(token: string): number {
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
      return decoded.offset || 0;
    } catch {
      return 0;
    }
  }

  private startCleanupTimer(): void {
    // Clean up old threads every hour
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [threadId, thread] of this.threads) {
        if (now - thread.lastModifiedAt.getTime() > this.TTL_MS) {
          this.hardDeleteThread(threadId);
        }
      }
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }
}
