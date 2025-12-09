import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
} from '../types';
import { v7 as uuidv7, v4 as uuidv4 } from 'uuid';

// Type definition for better-sqlite3 (optional dependency)
type Database = any;

/**
 * SQLite Chat Repository
 *
 * Enterprise-grade SQLite implementation for standalone demos.
 * Implements the same patterns as production (CosmosDB):
 * - Optimistic concurrency control (ETags via version column)
 * - Soft deletes (isDeleted flag)
 * - Continuation token pagination
 * - Composite indexes for efficient queries
 *
 * Features:
 * - Zero external dependencies (uses better-sqlite3)
 * - Persists across restarts
 * - Single file database
 * - Full-text search support (optional)
 *
 * Use cases:
 * - Standalone demos
 * - Desktop applications
 * - Edge deployments
 * - GitHub repo showcase (just clone & run)
 */
@Injectable()
export class SQLiteChatRepository implements IChatRepository, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SQLiteChatRepository.name);
  private db: Database | null = null;
  private readonly dbPath: string;
  private initialized = false;

  constructor(private configService: ConfigService) {
    this.dbPath = this.configService.get('DATABASE_SQLITE_PATH', './data/chat.db');
  }

  async onModuleInit(): Promise<void> {
    // Only initialize if SQLite provider is selected
    const provider = this.configService.get('DATABASE_PROVIDER', 'memory');
    if (provider === 'sqlite') {
      await this.initialize();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to avoid bundling issues when SQLite isn't used
      // better-sqlite3 is a synchronous CommonJS module, so we use require()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');

      // Ensure directory exists
      const path = await import('path');
      const fs = await import('fs');
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrent performance
      this.db.pragma('journal_mode = WAL');

      // Create tables with new schema
      this.createTables();

      this.initialized = true;
      this.logger.log(`SQLiteChatRepository initialized at ${this.dbPath}`);
    } catch (error) {
      this.logger.error('Failed to initialize SQLite:', error);
      throw new Error(
        'SQLite initialization failed. Make sure better-sqlite3 is installed: yarn add better-sqlite3 @types/better-sqlite3',
      );
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error(
        'SQLite repository not initialized. Set DATABASE_PROVIDER=sqlite and ensure better-sqlite3 is installed.',
      );
    }
  }

  private createTables(): void {
    // Threads table with enterprise schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'CHAT_THREAD',
        userId TEXT NOT NULL,
        title TEXT,
        isBookmarked INTEGER NOT NULL DEFAULT 0,
        isDeleted INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        traceId TEXT,
        createdAt TEXT NOT NULL,
        lastModifiedAt TEXT NOT NULL,
        _etag TEXT,
        _version INTEGER NOT NULL DEFAULT 1
      );

      -- Composite indexes aligned with query patterns (like CosmosDB)
      CREATE INDEX IF NOT EXISTS idx_threads_userId_type_deleted_bookmark_modified
        ON threads(userId, type, isDeleted, isBookmarked, lastModifiedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_threads_userId_modified
        ON threads(userId, lastModifiedAt DESC);
    `);

    // Messages table with enterprise schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'CHAT_MESSAGE',
        threadId TEXT NOT NULL,
        userId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        isDeleted INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        createdAt TEXT NOT NULL,
        lastModifiedAt TEXT NOT NULL,
        _etag TEXT,
        _version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (threadId) REFERENCES threads(id) ON DELETE CASCADE
      );

      -- Composite indexes for message queries
      CREATE INDEX IF NOT EXISTS idx_messages_threadId_deleted_created
        ON messages(threadId, isDeleted, createdAt ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_threadId_role
        ON messages(threadId, role, isDeleted);
    `);

    // Version tracking table for cache invalidation
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_versions (
        threadId TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS user_versions (
        userId TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.logger.log('SQLiteChatRepository closed');
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      this.ensureInitialized();
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Thread Operations
  // -------------------------------------------------------------------------

  async createThread(
    thread: Pick<ChatThread, 'id' | 'userId' | 'title' | 'metadata' | 'isBookmarked' | 'traceId'>,
  ): Promise<ChatThread> {
    this.ensureInitialized();

    const now = new Date().toISOString();
    const id = thread.id || uuidv7();
    const etag = this.generateEtag();

    const stmt = this.db.prepare(`
      INSERT INTO threads (id, type, userId, title, isBookmarked, isDeleted, metadata, traceId, createdAt, lastModifiedAt, _etag, _version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      ENTITY_TYPES.CHAT_THREAD,
      thread.userId,
      thread.title || null,
      thread.isBookmarked ? 1 : 0,
      0, // isDeleted
      JSON.stringify(thread.metadata || {}),
      thread.traceId || null,
      now,
      now,
      etag,
      1,
    );

    // Initialize thread version
    this.db.prepare('INSERT OR REPLACE INTO thread_versions (threadId, version) VALUES (?, 1)').run(id);

    // Increment user version
    this.incrementUserVersion(thread.userId);

    return this.rowToThread(this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id));
  }

  async getThread(threadId: string, includeDeleted = false): Promise<ChatThread | null> {
    this.ensureInitialized();

    let sql = 'SELECT * FROM threads WHERE id = ?';
    if (!includeDeleted) {
      sql += ' AND isDeleted = 0';
    }

    const row = this.db.prepare(sql).get(threadId);
    if (!row) return null;

    return this.rowToThread(row);
  }

  async updateThread(
    threadId: string,
    updates: Partial<Pick<ChatThread, 'title' | 'metadata' | 'isBookmarked'>>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<ChatThread>> {
    this.ensureInitialized();

    const existing = await this.getThread(threadId, true);
    if (!existing || existing.isDeleted) {
      return { success: false, error: 'Thread not found' };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== existing._etag) {
      if (options.retryOnConflict !== false) {
        return this.updateThread(threadId, updates, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    const now = new Date().toISOString();
    const newEtag = this.generateEtag();
    const newMetadata = { ...existing.metadata, ...updates.metadata };

    const stmt = this.db.prepare(`
      UPDATE threads
      SET title = COALESCE(?, title),
          isBookmarked = COALESCE(?, isBookmarked),
          metadata = ?,
          lastModifiedAt = ?,
          _etag = ?,
          _version = _version + 1
      WHERE id = ?
    `);

    stmt.run(
      updates.title ?? existing.title,
      updates.isBookmarked !== undefined ? (updates.isBookmarked ? 1 : 0) : null,
      JSON.stringify(newMetadata),
      now,
      newEtag,
      threadId,
    );

    this.incrementThreadVersion(threadId);
    this.incrementUserVersion(existing.userId);

    const updated = await this.getThread(threadId);
    return { success: true, entity: updated!, newEtag };
  }

  async deleteThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<void>> {
    this.ensureInitialized();

    const existing = await this.getThread(threadId, true);
    if (!existing) {
      return { success: false, error: 'Thread not found' };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== existing._etag) {
      if (options.retryOnConflict !== false) {
        return this.deleteThread(threadId, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    const now = new Date().toISOString();
    const newEtag = this.generateEtag();

    // Soft delete
    this.db
      .prepare(
        `
      UPDATE threads SET isDeleted = 1, lastModifiedAt = ?, _etag = ?, _version = _version + 1 WHERE id = ?
    `,
      )
      .run(now, newEtag, threadId);

    this.incrementUserVersion(existing.userId);

    return { success: true, newEtag };
  }

  async hardDeleteThread(threadId: string): Promise<boolean> {
    this.ensureInitialized();

    const existing = await this.getThread(threadId, true);
    if (!existing) return false;

    // Messages will be cascade deleted due to foreign key
    const result = this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
    this.db.prepare('DELETE FROM thread_versions WHERE threadId = ?').run(threadId);

    this.incrementUserVersion(existing.userId);

    return result.changes > 0;
  }

  async restoreThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<ChatThread>> {
    this.ensureInitialized();

    const existing = await this.getThread(threadId, true);
    if (!existing) {
      return { success: false, error: 'Thread not found' };
    }

    if (!existing.isDeleted) {
      return { success: true, entity: existing };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== existing._etag) {
      if (options.retryOnConflict !== false) {
        return this.restoreThread(threadId, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    const now = new Date().toISOString();
    const newEtag = this.generateEtag();

    this.db
      .prepare(
        `
      UPDATE threads SET isDeleted = 0, lastModifiedAt = ?, _etag = ?, _version = _version + 1 WHERE id = ?
    `,
      )
      .run(now, newEtag, threadId);

    this.incrementUserVersion(existing.userId);

    const updated = await this.getThread(threadId);
    return { success: true, entity: updated!, newEtag };
  }

  async listThreads(options?: ThreadQueryOptions): Promise<PaginatedResult<ChatThread>> {
    this.ensureInitialized();

    let sql = 'SELECT * FROM threads WHERE 1=1';
    const params: any[] = [];

    if (options?.userId) {
      sql += ' AND userId = ?';
      params.push(options.userId);
    }

    if (!options?.includeDeleted) {
      sql += ' AND isDeleted = 0';
    }

    if (options?.isBookmarked !== undefined) {
      sql += ' AND isBookmarked = ?';
      params.push(options.isBookmarked ? 1 : 0);
    }

    // Count total (before pagination)
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
    const totalCount = this.db.prepare(countSql).get(...params).count;

    const sortBy = options?.sortBy || 'lastModifiedAt';
    const sortOrder = options?.sortOrder || 'desc';
    sql += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;

    const limit = Math.min(
      options?.limit || PAGINATION_DEFAULTS.THREADS_PAGE_SIZE,
      PAGINATION_DEFAULTS.THREADS_PAGE_SIZE_MAX,
    );

    let offset = 0;
    if (options?.continuationToken) {
      offset = this.decodeContinuationToken(options.continuationToken);
    } else if (options?.offset) {
      offset = options.offset;
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params);
    const items = rows.map((row: any) => this.rowToThread(row));
    const hasMore = offset + limit < totalCount;

    return {
      items,
      continuationToken: hasMore ? this.encodeContinuationToken(offset + limit) : undefined,
      hasMore,
      totalCount,
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
    this.ensureInitialized();

    const now = new Date().toISOString();
    const id = message.id || uuidv7();
    const etag = this.generateEtag();

    // Check if exists
    const existing = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

    if (existing) {
      // Update existing
      this.db
        .prepare(
          `
        UPDATE messages
        SET content = ?, metadata = ?, lastModifiedAt = ?, _etag = ?, _version = _version + 1
        WHERE id = ?
      `,
        )
        .run(message.content, JSON.stringify(message.metadata || {}), now, etag, id);
    } else {
      // Insert new
      this.db
        .prepare(
          `
        INSERT INTO messages (id, type, threadId, userId, role, content, isDeleted, metadata, createdAt, lastModifiedAt, _etag, _version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          ENTITY_TYPES.CHAT_MESSAGE,
          message.threadId,
          message.userId,
          message.role,
          message.content,
          0,
          JSON.stringify(message.metadata || {}),
          now,
          now,
          etag,
          1,
        );
    }

    // Update thread's lastModifiedAt
    const threadEtag = this.generateEtag();
    this.db
      .prepare(
        'UPDATE threads SET lastModifiedAt = ?, _etag = ?, _version = _version + 1 WHERE id = ? AND isDeleted = 0',
      )
      .run(now, threadEtag, message.threadId);

    // Update versions
    this.incrementThreadVersion(message.threadId);
    const thread = await this.getThread(message.threadId);
    if (thread) {
      this.incrementUserVersion(thread.userId);
    }

    return this.rowToMessage(this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
  }

  async getMessage(messageId: string, includeDeleted = false): Promise<ChatMessageEntity | null> {
    this.ensureInitialized();

    let sql = 'SELECT * FROM messages WHERE id = ?';
    if (!includeDeleted) {
      sql += ' AND isDeleted = 0';
    }

    const row = this.db.prepare(sql).get(messageId);
    if (!row) return null;

    return this.rowToMessage(row);
  }

  async getMessages(threadId: string, options?: MessageQueryOptions): Promise<PaginatedResult<ChatMessageEntity>> {
    this.ensureInitialized();

    let sql = 'SELECT * FROM messages WHERE threadId = ?';
    const params: any[] = [threadId];

    if (!options?.includeDeleted) {
      sql += ' AND isDeleted = 0';
    }

    if (options?.role) {
      sql += ' AND role = ?';
      params.push(options.role);
    }

    // Count total
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
    const totalCount = this.db.prepare(countSql).get(...params).count;

    sql += ' ORDER BY createdAt ASC';

    const limit = Math.min(
      options?.limit || PAGINATION_DEFAULTS.MESSAGES_PAGE_SIZE,
      PAGINATION_DEFAULTS.MESSAGES_PAGE_SIZE_MAX,
    );

    let offset = 0;
    if (options?.continuationToken) {
      offset = this.decodeContinuationToken(options.continuationToken);
    } else if (options?.offset) {
      offset = options.offset;
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params);
    const items = rows.map((row: any) => this.rowToMessage(row));
    const hasMore = offset + limit < totalCount;

    return {
      items,
      continuationToken: hasMore ? this.encodeContinuationToken(offset + limit) : undefined,
      hasMore,
      totalCount,
    };
  }

  async updateMessage(
    messageId: string,
    updates: Partial<Pick<ChatMessageEntity, 'content' | 'metadata'>>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<ChatMessageEntity>> {
    this.ensureInitialized();

    const existing = await this.getMessage(messageId, true);
    if (!existing || existing.isDeleted) {
      return { success: false, error: 'Message not found' };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== existing._etag) {
      if (options.retryOnConflict !== false) {
        return this.updateMessage(messageId, updates, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    const now = new Date().toISOString();
    const newEtag = this.generateEtag();
    const newMetadata = { ...existing.metadata, ...updates.metadata };

    this.db
      .prepare(
        `
      UPDATE messages
      SET content = COALESCE(?, content),
          metadata = ?,
          lastModifiedAt = ?,
          _etag = ?,
          _version = _version + 1
      WHERE id = ?
    `,
      )
      .run(updates.content ?? existing.content, JSON.stringify(newMetadata), now, newEtag, messageId);

    const updated = await this.getMessage(messageId);
    return { success: true, entity: updated!, newEtag };
  }

  async deleteMessage(messageId: string, options?: UpdateOptions): Promise<UpdateResult<void>> {
    this.ensureInitialized();

    const existing = await this.getMessage(messageId, true);
    if (!existing) {
      return { success: false, error: 'Message not found' };
    }

    // Optimistic concurrency check
    if (options?.ifMatch && options.ifMatch !== existing._etag) {
      if (options.retryOnConflict !== false) {
        return this.deleteMessage(messageId, { ...options, retryOnConflict: false });
      }
      return { success: false, conflict: true, error: 'ETag mismatch' };
    }

    const now = new Date().toISOString();
    const newEtag = this.generateEtag();

    // Soft delete
    this.db
      .prepare('UPDATE messages SET isDeleted = 1, lastModifiedAt = ?, _etag = ?, _version = _version + 1 WHERE id = ?')
      .run(now, newEtag, messageId);

    return { success: true, newEtag };
  }

  async hardDeleteMessage(messageId: string): Promise<boolean> {
    this.ensureInitialized();

    const result = this.db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    return result.changes > 0;
  }

  async countMessages(threadId: string, includeDeleted = false): Promise<number> {
    this.ensureInitialized();

    let sql = 'SELECT COUNT(*) as count FROM messages WHERE threadId = ?';
    if (!includeDeleted) {
      sql += ' AND isDeleted = 0';
    }

    const result = this.db.prepare(sql).get(threadId);
    return result.count;
  }

  async getLastMessage(threadId: string): Promise<ChatMessageEntity | null> {
    this.ensureInitialized();

    const row = this.db
      .prepare('SELECT * FROM messages WHERE threadId = ? AND isDeleted = 0 ORDER BY createdAt DESC LIMIT 1')
      .get(threadId);

    if (!row) return null;
    return this.rowToMessage(row);
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
    this.ensureInitialized();

    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        'UPDATE messages SET isDeleted = 1, lastModifiedAt = ?, _version = _version + 1 WHERE threadId = ? AND isDeleted = 0',
      )
      .run(now, threadId);

    return result.changes;
  }

  // -------------------------------------------------------------------------
  // Cache Support
  // -------------------------------------------------------------------------

  async getThreadVersion(threadId: string): Promise<number> {
    this.ensureInitialized();

    const row = this.db.prepare('SELECT version FROM thread_versions WHERE threadId = ?').get(threadId);
    return row?.version || 0;
  }

  async incrementThreadVersion(threadId: string): Promise<number> {
    this.ensureInitialized();

    this.db
      .prepare(
        `
      INSERT INTO thread_versions (threadId, version) VALUES (?, 1)
      ON CONFLICT(threadId) DO UPDATE SET version = version + 1
    `,
      )
      .run(threadId);

    return this.getThreadVersion(threadId);
  }

  private incrementUserVersion(userId: string): void {
    this.db
      .prepare(
        `
      INSERT INTO user_versions (userId, version) VALUES (?, 1)
      ON CONFLICT(userId) DO UPDATE SET version = version + 1
    `,
      )
      .run(userId);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private rowToThread(row: any): ChatThread {
    return {
      id: row.id,
      type: ENTITY_TYPES.CHAT_THREAD,
      userId: row.userId,
      title: row.title,
      isBookmarked: row.isBookmarked === 1,
      isDeleted: row.isDeleted === 1,
      metadata: JSON.parse(row.metadata || '{}'),
      traceId: row.traceId,
      createdAt: new Date(row.createdAt),
      lastModifiedAt: new Date(row.lastModifiedAt),
      _etag: row._etag,
      _version: row._version,
    };
  }

  private rowToMessage(row: any): ChatMessageEntity {
    return {
      id: row.id,
      type: ENTITY_TYPES.CHAT_MESSAGE,
      threadId: row.threadId,
      userId: row.userId,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      isDeleted: row.isDeleted === 1,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: new Date(row.createdAt),
      lastModifiedAt: new Date(row.lastModifiedAt),
      _etag: row._etag,
      _version: row._version,
    };
  }

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

  // -------------------------------------------------------------------------
  // Debug/Maintenance
  // -------------------------------------------------------------------------

  /**
   * Get database statistics
   */
  getStats(): {
    threadCount: number;
    messageCount: number;
    deletedThreads: number;
    deletedMessages: number;
    dbSizeBytes: number;
  } {
    this.ensureInitialized();

    const threads = this.db.prepare('SELECT COUNT(*) as count FROM threads WHERE isDeleted = 0').get();
    const deletedThreads = this.db.prepare('SELECT COUNT(*) as count FROM threads WHERE isDeleted = 1').get();
    const messages = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE isDeleted = 0').get();
    const deletedMessages = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE isDeleted = 1').get();

    // Get file size
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    let dbSizeBytes = 0;
    try {
      const stats = fs.statSync(this.dbPath);
      dbSizeBytes = stats.size;
    } catch {
      // File might not exist yet
    }

    return {
      threadCount: threads.count,
      messageCount: messages.count,
      deletedThreads: deletedThreads.count,
      deletedMessages: deletedMessages.count,
      dbSizeBytes,
    };
  }

  /**
   * Vacuum database to reclaim space from soft-deleted records
   */
  vacuum(): void {
    this.ensureInitialized();
    this.db.exec('VACUUM');
  }

  /**
   * Purge soft-deleted records older than specified days
   */
  purgeDeleted(olderThanDays: number = 30): { threadsRemoved: number; messagesRemoved: number } {
    this.ensureInitialized();

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

    const messagesResult = this.db
      .prepare('DELETE FROM messages WHERE isDeleted = 1 AND lastModifiedAt < ?')
      .run(cutoff);

    const threadsResult = this.db.prepare('DELETE FROM threads WHERE isDeleted = 1 AND lastModifiedAt < ?').run(cutoff);

    return {
      threadsRemoved: threadsResult.changes,
      messagesRemoved: messagesResult.changes,
    };
  }
}
