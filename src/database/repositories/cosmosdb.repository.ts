import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CosmosClient,
  Container,
  Database,
  FeedOptions,
  SqlQuerySpec,
  JSONValue,
  RequestOptions,
  ConsistencyLevel,
} from '@azure/cosmos';
import {
  IChatRepository,
  ChatThread,
  ChatMessageEntity,
  ThreadQueryOptions,
  MessageQueryOptions,
  PaginatedResult,
  UpdateResult,
  UpdateOptions,
  ReadOptions,
  ENTITY_TYPES,
  PAGINATION_DEFAULTS,
} from '../types';
import { v7 as uuidv7 } from 'uuid';

/**
 * CosmosDB document structure
 * All entities stored in single container with type discriminator
 */
interface CosmosDocument {
  id: string;
  type: string;
  userId: string; // Partition key
  [key: string]: unknown;
}

/**
 * Azure CosmosDB Chat Repository
 *
 * Production-ready implementation with enterprise patterns:
 * - Single container with type discriminator (cost-effective)
 * - Partition key: userId (for user isolation and query efficiency)
 * - Optimistic concurrency control via ETags
 * - Continuation token pagination (native CosmosDB)
 * - Soft deletes
 * - TTL support (optional)
 *
 * Container design:
 * - All threads and messages in single container
 * - Partition key: /userId
 * - Type discriminator: CHAT_THREAD | CHAT_MESSAGE
 * - Composite indexes for efficient queries
 */
@Injectable()
export class CosmosDBChatRepository implements IChatRepository, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CosmosDBChatRepository.name);

  private client: CosmosClient;
  private database: Database;
  private container: Container;

  private readonly databaseName: string;
  private readonly containerName: string;
  private readonly consistencyLevel: ConsistencyLevel;

  /**
   * Last session token from write operations.
   * Used internally for read-your-writes consistency within the same request flow.
   * For cross-request consistency, clients should capture sessionToken from UpdateResult.
   */
  private lastSessionToken?: string;

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.get<string>('AZURE_COSMOSDB_ENDPOINT');
    const key = this.configService.get<string>('AZURE_COSMOSDB_KEY');

    if (!endpoint || !key) {
      throw new Error('CosmosDB configuration missing: AZURE_COSMOSDB_ENDPOINT and AZURE_COSMOSDB_KEY required');
    }

    // Configure consistency level (default: Session for read-your-writes)
    // Options: Strong, BoundedStaleness, Session, ConsistentPrefix, Eventual
    const consistencyLevelConfig = this.configService.get<string>('AZURE_COSMOSDB_CONSISTENCY_LEVEL', 'Session');
    this.consistencyLevel = this.parseConsistencyLevel(consistencyLevelConfig);

    this.client = new CosmosClient({
      endpoint,
      key,
      consistencyLevel: this.consistencyLevel,
    });
    this.databaseName = this.configService.get<string>('AZURE_COSMOSDB_DATABASE', 'chatdb');
    this.containerName = this.configService.get<string>('AZURE_COSMOSDB_CONTAINER', 'chat');
  }

  /**
   * Parse consistency level from config string
   */
  private parseConsistencyLevel(level: string): ConsistencyLevel {
    const mapping: Record<string, ConsistencyLevel> = {
      Strong: 'Strong' as ConsistencyLevel,
      BoundedStaleness: 'BoundedStaleness' as ConsistencyLevel,
      Session: 'Session' as ConsistencyLevel,
      ConsistentPrefix: 'ConsistentPrefix' as ConsistencyLevel,
      Eventual: 'Eventual' as ConsistencyLevel,
    };
    return mapping[level] || ('Session' as ConsistencyLevel);
  }

  /**
   * Build request options with session token for read-your-writes consistency
   */
  private buildRequestOptions(sessionToken?: string): RequestOptions {
    const options: RequestOptions = {};
    const token = sessionToken || this.lastSessionToken;
    if (token) {
      options.sessionToken = token;
    }
    return options;
  }

  /**
   * Extract session token from CosmosDB response headers
   * Headers can have mixed types; this safely extracts the string token
   */
  private extractSessionToken(headers?: { [key: string]: string | number | boolean }): string | undefined {
    if (!headers) return undefined;
    const token = headers['x-ms-session-token'];
    return typeof token === 'string' ? token : undefined;
  }

  async onModuleInit() {
    await this.initialize();
  }

  async onModuleDestroy() {
    await this.close();
  }

  // -------------------------------------------------------------------------
  // Thread Operations
  // -------------------------------------------------------------------------

  async createThread(
    thread: Pick<ChatThread, 'id' | 'userId' | 'title' | 'metadata' | 'isBookmarked' | 'traceId'>,
  ): Promise<ChatThread> {
    const now = new Date();
    const id = thread.id || uuidv7();

    const fullThread: ChatThread & CosmosDocument = {
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
      _version: 1,
    };

    const { resource, headers } = await this.container.items.create(fullThread);

    // Capture session token for read-your-writes consistency
    const newSessionToken = this.extractSessionToken(headers);
    if (newSessionToken) {
      this.lastSessionToken = newSessionToken;
    }

    const created = this.mapToThread(resource);

    this.logger.debug(`Created thread ${id} for user ${thread.userId}`);
    return created;
  }

  async getThread(threadId: string, includeDeletedOrOptions?: boolean | ReadOptions): Promise<ChatThread | null> {
    // Handle both legacy boolean and new ReadOptions interface
    const includeDeleted =
      typeof includeDeletedOrOptions === 'boolean'
        ? includeDeletedOrOptions
        : includeDeletedOrOptions?.includeDeleted ?? false;
    const sessionToken = typeof includeDeletedOrOptions === 'object' ? includeDeletedOrOptions.sessionToken : undefined;

    // Query by id since we don't know the userId (partition key) in this case
    const querySpec: SqlQuerySpec = {
      query: `SELECT * FROM c WHERE c.id = @id AND c.type = @type${includeDeleted ? '' : ' AND c.isDeleted = false'}`,
      parameters: [
        { name: '@id', value: threadId },
        { name: '@type', value: ENTITY_TYPES.CHAT_THREAD },
      ],
    };

    const feedOptions: FeedOptions = this.buildRequestOptions(sessionToken);
    const { resources } = await this.container.items.query<CosmosDocument>(querySpec, feedOptions).fetchAll();

    if (resources.length === 0) return null;
    return this.mapToThread(resources[0]);
  }

  async updateThread(
    threadId: string,
    updates: Partial<Pick<ChatThread, 'title' | 'metadata' | 'isBookmarked'>>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<ChatThread>> {
    // Use session token from options for read, or fall back to last known token
    const existing = await this.getThread(threadId, { includeDeleted: true, sessionToken: options?.sessionToken });
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

    const updated: ChatThread & CosmosDocument = {
      ...existing,
      ...updates,
      metadata: { ...existing.metadata, ...updates.metadata },
      lastModifiedAt: new Date(),
      _version: (existing._version || 0) + 1,
    } as ChatThread & CosmosDocument;

    try {
      const { resource, headers } = await this.container.item(threadId, existing.userId).replace(updated, {
        accessCondition: options?.ifMatch ? { type: 'IfMatch', condition: options.ifMatch } : undefined,
      });

      // Capture session token for read-your-writes consistency
      const newSessionToken = this.extractSessionToken(headers);
      if (newSessionToken) {
        this.lastSessionToken = newSessionToken;
      }

      const result = this.mapToThread(resource);
      return { success: true, entity: result, newEtag: result._etag, sessionToken: newSessionToken };
    } catch (error: any) {
      if (error.code === 412) {
        return { success: false, conflict: true, error: 'Precondition failed - document was modified' };
      }
      throw error;
    }
  }

  async deleteThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<void>> {
    const existing = await this.getThread(threadId, { includeDeleted: true, sessionToken: options?.sessionToken });
    if (!existing) {
      return { success: false, error: 'Thread not found' };
    }

    // Soft delete
    const result = await this.updateThread(
      threadId,
      { metadata: { ...existing.metadata, deletedAt: new Date().toISOString() } } as any,
      options,
    );

    if (!result.success) {
      return { success: false, conflict: result.conflict, error: result.error };
    }

    // Set isDeleted flag
    const updated = {
      ...existing,
      isDeleted: true,
      lastModifiedAt: new Date(),
      _version: (existing._version || 0) + 1,
    } as ChatThread & CosmosDocument;

    const { headers } = await this.container.item(threadId, existing.userId).replace(updated);

    // Capture session token
    const newSessionToken = this.extractSessionToken(headers);
    if (newSessionToken) {
      this.lastSessionToken = newSessionToken;
    }

    this.logger.debug(`Soft deleted thread ${threadId}`);
    return { success: true, newEtag: result.newEtag, sessionToken: newSessionToken };
  }

  async hardDeleteThread(threadId: string): Promise<boolean> {
    const thread = await this.getThread(threadId, true);
    if (!thread) return false;

    // Delete all messages in thread first
    const messages = await this.getAllMessages(threadId);
    for (const msg of messages) {
      await this.container.item(msg.id, msg.userId).delete();
    }

    // Delete the thread
    await this.container.item(threadId, thread.userId).delete();

    this.logger.debug(`Hard deleted thread ${threadId} with ${messages.length} messages`);
    return true;
  }

  async restoreThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<ChatThread>> {
    const existing = await this.getThread(threadId, { includeDeleted: true, sessionToken: options?.sessionToken });
    if (!existing) {
      return { success: false, error: 'Thread not found' };
    }

    if (!existing.isDeleted) {
      return { success: true, entity: existing };
    }

    const updated = {
      ...existing,
      isDeleted: false,
      lastModifiedAt: new Date(),
      _version: (existing._version || 0) + 1,
    } as ChatThread & CosmosDocument;

    try {
      const { resource, headers } = await this.container.item(threadId, existing.userId).replace(updated, {
        accessCondition: options?.ifMatch ? { type: 'IfMatch', condition: options.ifMatch } : undefined,
      });

      // Capture session token
      const newSessionToken = this.extractSessionToken(headers);
      if (newSessionToken) {
        this.lastSessionToken = newSessionToken;
      }

      const result = this.mapToThread(resource);
      this.logger.debug(`Restored thread ${threadId}`);
      return { success: true, entity: result, newEtag: result._etag, sessionToken: newSessionToken };
    } catch (error: any) {
      if (error.code === 412) {
        return { success: false, conflict: true, error: 'Precondition failed' };
      }
      throw error;
    }
  }

  async listThreads(options?: ThreadQueryOptions): Promise<PaginatedResult<ChatThread>> {
    const conditions: string[] = [`c.type = "${ENTITY_TYPES.CHAT_THREAD}"`];
    const parameters: { name: string; value: JSONValue }[] = [];

    // Filter by userId (uses partition key - efficient)
    if (options?.userId) {
      conditions.push('c.userId = @userId');
      parameters.push({ name: '@userId', value: options.userId });
    }

    // Filter soft deleted
    if (!options?.includeDeleted) {
      conditions.push('c.isDeleted = false');
    }

    // Filter by bookmark
    if (options?.isBookmarked !== undefined) {
      conditions.push('c.isBookmarked = @isBookmarked');
      parameters.push({ name: '@isBookmarked', value: options.isBookmarked });
    }

    // Sort (aligned with composite indexes)
    const sortBy = options?.sortBy || 'lastModifiedAt';
    const sortOrder = options?.sortOrder || 'desc';

    const querySpec: SqlQuerySpec = {
      query: `SELECT * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.${sortBy} ${sortOrder.toUpperCase()}`,
      parameters,
    };

    const limit = Math.min(
      options?.limit || PAGINATION_DEFAULTS.THREADS_PAGE_SIZE,
      PAGINATION_DEFAULTS.THREADS_PAGE_SIZE_MAX,
    );

    const feedOptions: FeedOptions = {
      maxItemCount: limit,
      continuationToken: options?.continuationToken,
    };

    // If userId provided, query within partition (much more efficient)
    const queryIterator = options?.userId
      ? this.container.items.query<CosmosDocument>(querySpec, { ...feedOptions, partitionKey: options.userId })
      : this.container.items.query<CosmosDocument>(querySpec, feedOptions);

    const { resources, continuationToken } = await queryIterator.fetchNext();

    return {
      items: resources.map((r) => this.mapToThread(r)),
      continuationToken: continuationToken || undefined,
      hasMore: !!continuationToken,
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
    const now = new Date();

    // Check if exists for upsert
    const existing = await this.getMessage(id, { includeDeleted: true });

    const fullMessage: ChatMessageEntity & CosmosDocument = {
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
      _version: existing ? (existing._version || 0) + 1 : 1,
    };

    const { resource, headers } = await this.container.items.upsert(fullMessage);

    // Capture session token for read-your-writes consistency
    const newSessionToken = this.extractSessionToken(headers);
    if (newSessionToken) {
      this.lastSessionToken = newSessionToken;
    }

    // Update thread's lastModifiedAt (moves to top of list)
    await this.touchThread(message.threadId);

    return this.mapToMessage(resource);
  }

  async getMessage(
    messageId: string,
    includeDeletedOrOptions?: boolean | ReadOptions,
  ): Promise<ChatMessageEntity | null> {
    // Handle both legacy boolean and new ReadOptions interface
    const includeDeleted =
      typeof includeDeletedOrOptions === 'boolean'
        ? includeDeletedOrOptions
        : includeDeletedOrOptions?.includeDeleted ?? false;
    const sessionToken = typeof includeDeletedOrOptions === 'object' ? includeDeletedOrOptions.sessionToken : undefined;

    const querySpec: SqlQuerySpec = {
      query: `SELECT * FROM c WHERE c.id = @id AND c.type = @type${includeDeleted ? '' : ' AND c.isDeleted = false'}`,
      parameters: [
        { name: '@id', value: messageId },
        { name: '@type', value: ENTITY_TYPES.CHAT_MESSAGE },
      ],
    };

    const feedOptions: FeedOptions = this.buildRequestOptions(sessionToken);
    const { resources } = await this.container.items.query<CosmosDocument>(querySpec, feedOptions).fetchAll();

    if (resources.length === 0) return null;
    return this.mapToMessage(resources[0]);
  }

  async getMessages(threadId: string, options?: MessageQueryOptions): Promise<PaginatedResult<ChatMessageEntity>> {
    const conditions: string[] = [`c.type = "${ENTITY_TYPES.CHAT_MESSAGE}"`, 'c.threadId = @threadId'];
    const parameters: { name: string; value: JSONValue }[] = [{ name: '@threadId', value: threadId }];

    // Filter soft deleted
    if (!options?.includeDeleted) {
      conditions.push('c.isDeleted = false');
    }

    // Filter by role
    if (options?.role) {
      conditions.push('c.role = @role');
      parameters.push({ name: '@role', value: options.role });
    }

    // Sort by createdAt ascending (conversation order)
    const querySpec: SqlQuerySpec = {
      query: `SELECT * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.createdAt ASC`,
      parameters,
    };

    const limit = Math.min(
      options?.limit || PAGINATION_DEFAULTS.MESSAGES_PAGE_SIZE,
      PAGINATION_DEFAULTS.MESSAGES_PAGE_SIZE_MAX,
    );

    const feedOptions: FeedOptions = {
      maxItemCount: limit,
      continuationToken: options?.continuationToken,
    };

    const queryIterator = this.container.items.query<CosmosDocument>(querySpec, feedOptions);
    const { resources, continuationToken } = await queryIterator.fetchNext();

    return {
      items: resources.map((r) => this.mapToMessage(r)),
      continuationToken: continuationToken || undefined,
      hasMore: !!continuationToken,
    };
  }

  async updateMessage(
    messageId: string,
    updates: Partial<Pick<ChatMessageEntity, 'content' | 'metadata'>>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<ChatMessageEntity>> {
    const existing = await this.getMessage(messageId, { includeDeleted: true, sessionToken: options?.sessionToken });
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

    const updated: ChatMessageEntity & CosmosDocument = {
      ...existing,
      ...updates,
      metadata: { ...existing.metadata, ...updates.metadata },
      lastModifiedAt: new Date(),
      _version: (existing._version || 0) + 1,
    } as ChatMessageEntity & CosmosDocument;

    try {
      const { resource, headers } = await this.container.item(messageId, existing.userId).replace(updated, {
        accessCondition: options?.ifMatch ? { type: 'IfMatch', condition: options.ifMatch } : undefined,
      });

      // Capture session token for read-your-writes consistency
      const newSessionToken = this.extractSessionToken(headers);
      if (newSessionToken) {
        this.lastSessionToken = newSessionToken;
      }

      const result = this.mapToMessage(resource);
      return { success: true, entity: result, newEtag: result._etag, sessionToken: newSessionToken };
    } catch (error: any) {
      if (error.code === 412) {
        return { success: false, conflict: true, error: 'Precondition failed' };
      }
      throw error;
    }
  }

  async deleteMessage(messageId: string, options?: UpdateOptions): Promise<UpdateResult<void>> {
    const existing = await this.getMessage(messageId, { includeDeleted: true, sessionToken: options?.sessionToken });
    if (!existing) {
      return { success: false, error: 'Message not found' };
    }

    // Soft delete
    const updated = {
      ...existing,
      isDeleted: true,
      lastModifiedAt: new Date(),
      _version: (existing._version || 0) + 1,
    } as ChatMessageEntity & CosmosDocument;

    try {
      const { resource, headers } = await this.container.item(messageId, existing.userId).replace(updated, {
        accessCondition: options?.ifMatch ? { type: 'IfMatch', condition: options.ifMatch } : undefined,
      });

      // Capture session token for read-your-writes consistency
      const newSessionToken = this.extractSessionToken(headers);
      if (newSessionToken) {
        this.lastSessionToken = newSessionToken;
      }

      return { success: true, newEtag: resource?._etag, sessionToken: newSessionToken };
    } catch (error: any) {
      if (error.code === 412) {
        return { success: false, conflict: true, error: 'Precondition failed' };
      }
      throw error;
    }
  }

  async hardDeleteMessage(messageId: string): Promise<boolean> {
    const message = await this.getMessage(messageId, true);
    if (!message) return false;

    await this.container.item(messageId, message.userId).delete();
    return true;
  }

  async countMessages(threadId: string, includeDeleted = false): Promise<number> {
    const querySpec: SqlQuerySpec = {
      query: `SELECT VALUE COUNT(1) FROM c WHERE c.type = @type AND c.threadId = @threadId${
        includeDeleted ? '' : ' AND c.isDeleted = false'
      }`,
      parameters: [
        { name: '@type', value: ENTITY_TYPES.CHAT_MESSAGE },
        { name: '@threadId', value: threadId },
      ],
    };

    const { resources } = await this.container.items.query<number>(querySpec).fetchAll();
    return resources[0] || 0;
  }

  async getLastMessage(threadId: string): Promise<ChatMessageEntity | null> {
    const querySpec: SqlQuerySpec = {
      query: `SELECT TOP 1 * FROM c WHERE c.type = @type AND c.threadId = @threadId AND c.isDeleted = false ORDER BY c.createdAt DESC`,
      parameters: [
        { name: '@type', value: ENTITY_TYPES.CHAT_MESSAGE },
        { name: '@threadId', value: threadId },
      ],
    };

    const { resources } = await this.container.items.query<CosmosDocument>(querySpec).fetchAll();

    if (resources.length === 0) return null;
    return this.mapToMessage(resources[0]);
  }

  // -------------------------------------------------------------------------
  // Batch Operations
  // -------------------------------------------------------------------------

  async bulkUpsertMessages(messages: ChatMessageEntity[]): Promise<ChatMessageEntity[]> {
    const results: ChatMessageEntity[] = [];

    // CosmosDB supports batch operations within same partition
    // Group messages by userId for efficient batching
    const byUser = new Map<string, ChatMessageEntity[]>();
    for (const msg of messages) {
      const userMsgs = byUser.get(msg.userId) || [];
      userMsgs.push(msg);
      byUser.set(msg.userId, userMsgs);
    }

    for (const [userId, userMessages] of byUser) {
      // For simplicity, upsert one by one (CosmosDB transactional batch has limits)
      for (const msg of userMessages) {
        const result = await this.upsertMessage(msg);
        results.push(result);
      }
    }

    return results;
  }

  async bulkDeleteMessages(threadId: string): Promise<number> {
    const messages = await this.getAllMessages(threadId);
    let count = 0;

    for (const msg of messages) {
      if (!msg.isDeleted) {
        await this.deleteMessage(msg.id);
        count++;
      }
    }

    return count;
  }

  // -------------------------------------------------------------------------
  // Cache Support
  // -------------------------------------------------------------------------

  async getThreadVersion(threadId: string): Promise<number> {
    const thread = await this.getThread(threadId, true);
    return thread?._version || 0;
  }

  async incrementThreadVersion(threadId: string): Promise<number> {
    const thread = await this.getThread(threadId, true);
    if (!thread) return 0;

    const newVersion = (thread._version || 0) + 1;
    await this.updateThread(threadId, {});
    return newVersion;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    try {
      // Create database if not exists
      const { database } = await this.client.databases.createIfNotExists({
        id: this.databaseName,
      });
      this.database = database;

      // Create container if not exists with proper configuration
      const { container } = await this.database.containers.createIfNotExists({
        id: this.containerName,
        partitionKey: { paths: ['/userId'] },
        indexingPolicy: {
          indexingMode: 'consistent',
          automatic: true,
          includedPaths: [{ path: '/*' }],
          excludedPaths: [{ path: '/content/*' }, { path: '/"_etag"/?' }],
          compositeIndexes: [
            [
              { path: '/userId', order: 'ascending' },
              { path: '/type', order: 'ascending' },
              { path: '/lastModifiedAt', order: 'descending' },
            ],
            [
              { path: '/userId', order: 'ascending' },
              { path: '/type', order: 'ascending' },
              { path: '/createdAt', order: 'ascending' },
            ],
            [
              { path: '/threadId', order: 'ascending' },
              { path: '/createdAt', order: 'ascending' },
            ],
          ],
        },
      });
      this.container = container;

      this.logger.log(`CosmosDB initialized: ${this.databaseName}/${this.containerName}`);
    } catch (error) {
      this.logger.error('Failed to initialize CosmosDB', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    // CosmosClient doesn't require explicit cleanup
    this.logger.log('CosmosDB connection closed');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.database.read();
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private async getAllMessages(threadId: string): Promise<ChatMessageEntity[]> {
    const querySpec: SqlQuerySpec = {
      query: `SELECT * FROM c WHERE c.type = @type AND c.threadId = @threadId`,
      parameters: [
        { name: '@type', value: ENTITY_TYPES.CHAT_MESSAGE },
        { name: '@threadId', value: threadId },
      ],
    };

    const { resources } = await this.container.items.query<CosmosDocument>(querySpec).fetchAll();
    return resources.map((r) => this.mapToMessage(r));
  }

  private mapToThread(doc: Record<string, unknown> | undefined): ChatThread {
    if (!doc) throw new Error('Document is undefined');

    return {
      id: doc.id as string,
      type: ENTITY_TYPES.CHAT_THREAD,
      userId: doc.userId as string,
      title: doc.title as string | undefined,
      metadata: doc.metadata as ChatThread['metadata'],
      isBookmarked: doc.isBookmarked as boolean | undefined,
      traceId: doc.traceId as string | undefined,
      createdAt: new Date(doc.createdAt as string),
      lastModifiedAt: new Date(doc.lastModifiedAt as string),
      isDeleted: doc.isDeleted as boolean,
      _etag: doc._etag as string | undefined,
      _version: doc._version as number | undefined,
    };
  }

  private mapToMessage(doc: Record<string, unknown> | undefined): ChatMessageEntity {
    if (!doc) throw new Error('Document is undefined');

    return {
      id: doc.id as string,
      type: ENTITY_TYPES.CHAT_MESSAGE,
      userId: doc.userId as string,
      threadId: doc.threadId as string,
      role: doc.role as ChatMessageEntity['role'],
      content: doc.content as string,
      metadata: doc.metadata as ChatMessageEntity['metadata'],
      createdAt: new Date(doc.createdAt as string),
      lastModifiedAt: new Date(doc.lastModifiedAt as string),
      isDeleted: doc.isDeleted as boolean,
      _etag: doc._etag as string | undefined,
      _version: doc._version as number | undefined,
    };
  }
}
