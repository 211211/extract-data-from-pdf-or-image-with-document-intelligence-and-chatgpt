/**
 * Database Abstraction Types
 *
 * Defines entities and interfaces for chat persistence.
 * Provider-agnostic design allows swapping databases without code changes.
 *
 * Patterns implemented:
 * - Optimistic concurrency control (ETags/versions)
 * - Soft deletes (isDeleted flag)
 * - Continuation token pagination
 * - Metadata extensibility
 * - High CCU support
 */

// ============================================================================
// Entity Types (discriminator pattern)
// ============================================================================

export const ENTITY_TYPES = {
  CHAT_THREAD: 'CHAT_THREAD',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
} as const;

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

// ============================================================================
// Base Entity
// ============================================================================

/**
 * Base entity with common fields for all entities
 */
export interface BaseEntity {
  id: string;
  type: EntityType;
  userId: string;
  createdAt: Date;
  lastModifiedAt: Date;
  isDeleted: boolean;
  /** Optimistic concurrency control - ETag or version number */
  _etag?: string;
  /** Version number for cache invalidation */
  _version?: number;
}

// ============================================================================
// Thread Entity
// ============================================================================

export type ChatType = 'simple' | 'rag' | 'multi-agent' | 'data' | 'custom';

/**
 * Thread metadata for extensibility
 */
export interface ThreadMetadata {
  /** API version for schema migrations */
  apiVersion?: string;
  /** Chat type for agent routing */
  chatType?: ChatType;
  /** Custom fields */
  [key: string]: unknown;
}

/**
 * Chat Thread (Conversation)
 */
export interface ChatThread extends BaseEntity {
  type: typeof ENTITY_TYPES.CHAT_THREAD;
  /** Thread title/name */
  title?: string;
  /** Bookmarked for quick access */
  isBookmarked?: boolean;
  /** Extensible metadata */
  metadata?: ThreadMetadata;
  /** Distributed tracing ID */
  traceId?: string;
}

// ============================================================================
// Message Entity
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Citation from RAG/search
 */
export interface Citation {
  title: string;
  url?: string;
  snippet?: string;
  source?: string;
  relevanceScore?: number;
}

/**
 * Message metadata for extensibility
 */
export interface MessageMetadata {
  /** Agent that processed this message */
  agentType?: string;
  /** Distributed tracing ID */
  traceId?: string;
  /** RAG citations */
  citations?: Citation[];
  /** Token usage */
  tokensUsed?: number;
  /** Model used */
  modelName?: string;
  /** Long-running job ID */
  jobId?: string;
  /** Job status */
  jobStatus?: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** SSE stream ID for correlation */
  streamId?: string;
  /** Custom fields */
  [key: string]: unknown;
}

/**
 * Chat Message
 */
export interface ChatMessageEntity extends BaseEntity {
  type: typeof ENTITY_TYPES.CHAT_MESSAGE;
  /** Parent thread ID */
  threadId: string;
  /** Message role */
  role: MessageRole;
  /** Message content */
  content: string;
  /** Extensible metadata */
  metadata?: MessageMetadata;
}

// ============================================================================
// Query Options & Results
// ============================================================================

/**
 * Pagination using continuation tokens (Cosmos DB style)
 */
export interface PaginationOptions {
  /** Max items per page */
  limit?: number;
  /** Continuation token from previous page */
  continuationToken?: string;
  /** Legacy offset-based pagination (not recommended for high CCU) */
  offset?: number;
}

/**
 * Paginated result with continuation token
 */
export interface PaginatedResult<T> {
  items: T[];
  /** Token to fetch next page, undefined if no more pages */
  continuationToken?: string;
  /** Total count (optional, expensive for large datasets) */
  totalCount?: number;
  /** Whether there are more pages */
  hasMore: boolean;
}

/**
 * Thread query options
 */
export interface ThreadQueryOptions extends PaginationOptions {
  userId?: string;
  /** Filter by bookmark status */
  isBookmarked?: boolean;
  /** Sort field (aligned with composite indexes) */
  sortBy?: 'createdAt' | 'lastModifiedAt';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
  /** Include soft-deleted threads */
  includeDeleted?: boolean;
}

/**
 * Message query options
 */
export interface MessageQueryOptions extends PaginationOptions {
  /** Filter by role */
  role?: MessageRole;
  /** Include soft-deleted messages */
  includeDeleted?: boolean;
}

// ============================================================================
// Update Options (Optimistic Concurrency & Read-Your-Writes)
// ============================================================================

/**
 * Options for update operations with optimistic concurrency
 */
export interface UpdateOptions {
  /** Expected ETag for optimistic concurrency */
  ifMatch?: string;
  /** Retry on conflict (412) - default: true with single retry */
  retryOnConflict?: boolean;
  /**
   * Session token for read-your-writes consistency.
   * Pass the session token from a previous write to ensure
   * subsequent reads see that write (even from replicas).
   */
  sessionToken?: string;
}

/**
 * Options for read operations with consistency guarantees
 */
export interface ReadOptions {
  /**
   * Session token for read-your-writes consistency.
   * Use the session token returned from a write operation
   * to guarantee the read sees that write.
   */
  sessionToken?: string;
  /** Include soft-deleted items */
  includeDeleted?: boolean;
}

/**
 * Result of update operation
 */
export interface UpdateResult<T> {
  success: boolean;
  entity?: T;
  /** New ETag after update */
  newEtag?: string;
  /** Conflict occurred (412) */
  conflict?: boolean;
  /** Error message if failed */
  error?: string;
  /**
   * Session token for read-your-writes consistency.
   * Pass this token to subsequent read operations to guarantee
   * they see this write (CosmosDB Session consistency level).
   */
  sessionToken?: string;
}

// ============================================================================
// Repository Interface
// ============================================================================

/**
 * IChatRepository
 *
 * Abstract interface for chat persistence with enterprise patterns:
 * - Optimistic concurrency control (ETags)
 * - Soft deletes
 * - Continuation token pagination
 * - High CCU support
 *
 * Implementations can use any database:
 * - InMemory (development/demo)
 * - SQLite (standalone demo)
 * - PostgreSQL (production)
 * - CosmosDB (Azure)
 * - MongoDB (document store)
 */
export interface IChatRepository {
  // -------------------------------------------------------------------------
  // Thread Operations
  // -------------------------------------------------------------------------

  /**
   * Create a new chat thread
   */
  createThread(
    thread: Pick<ChatThread, 'id' | 'userId' | 'title' | 'metadata' | 'isBookmarked' | 'traceId'>,
  ): Promise<ChatThread>;

  /**
   * Get a thread by ID
   * @param includeDeleted - Include soft-deleted threads
   */
  getThread(threadId: string, includeDeleted?: boolean): Promise<ChatThread | null>;

  /**
   * Update a thread with optimistic concurrency
   */
  updateThread(
    threadId: string,
    updates: Partial<Pick<ChatThread, 'title' | 'metadata' | 'isBookmarked'>>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<ChatThread>>;

  /**
   * Soft delete a thread (sets isDeleted = true)
   */
  deleteThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<void>>;

  /**
   * Hard delete a thread (permanent removal)
   */
  hardDeleteThread(threadId: string): Promise<boolean>;

  /**
   * Restore a soft-deleted thread
   */
  restoreThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<ChatThread>>;

  /**
   * List threads with pagination (continuation token)
   */
  listThreads(options?: ThreadQueryOptions): Promise<PaginatedResult<ChatThread>>;

  /**
   * Update thread's lastModifiedAt (moves to top of list)
   */
  touchThread(threadId: string, options?: UpdateOptions): Promise<UpdateResult<ChatThread>>;

  // -------------------------------------------------------------------------
  // Message Operations
  // -------------------------------------------------------------------------

  /**
   * Add/upsert a message (idempotent)
   * Uses upsert pattern for streaming message updates
   */
  upsertMessage(
    message: Pick<ChatMessageEntity, 'id' | 'threadId' | 'userId' | 'role' | 'content' | 'metadata'>,
  ): Promise<ChatMessageEntity>;

  /**
   * Get a message by ID
   */
  getMessage(messageId: string, includeDeleted?: boolean): Promise<ChatMessageEntity | null>;

  /**
   * Get messages in a thread with pagination
   */
  getMessages(threadId: string, options?: MessageQueryOptions): Promise<PaginatedResult<ChatMessageEntity>>;

  /**
   * Update a message with optimistic concurrency
   */
  updateMessage(
    messageId: string,
    updates: Partial<Pick<ChatMessageEntity, 'content' | 'metadata'>>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<ChatMessageEntity>>;

  /**
   * Soft delete a message
   */
  deleteMessage(messageId: string, options?: UpdateOptions): Promise<UpdateResult<void>>;

  /**
   * Hard delete a message (permanent removal)
   */
  hardDeleteMessage(messageId: string): Promise<boolean>;

  /**
   * Count messages in a thread
   */
  countMessages(threadId: string, includeDeleted?: boolean): Promise<number>;

  /**
   * Get the last message in a thread
   */
  getLastMessage(threadId: string): Promise<ChatMessageEntity | null>;

  // -------------------------------------------------------------------------
  // Batch Operations (for high CCU scenarios)
  // -------------------------------------------------------------------------

  /**
   * Bulk upsert messages (for batch imports)
   */
  bulkUpsertMessages?(messages: ChatMessageEntity[]): Promise<ChatMessageEntity[]>;

  /**
   * Bulk soft delete messages in a thread
   */
  bulkDeleteMessages?(threadId: string): Promise<number>;

  // -------------------------------------------------------------------------
  // Cache Support
  // -------------------------------------------------------------------------

  /**
   * Get thread version for cache invalidation
   */
  getThreadVersion?(threadId: string): Promise<number>;

  /**
   * Increment thread version (invalidates caches)
   */
  incrementThreadVersion?(threadId: string): Promise<number>;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialize the repository (create tables, indexes, etc.)
   */
  initialize?(): Promise<void>;

  /**
   * Close connections and cleanup
   */
  close?(): Promise<void>;

  /**
   * Health check
   */
  isHealthy?(): Promise<boolean>;
}

// ============================================================================
// Provider Types
// ============================================================================

export type DatabaseProvider = 'memory' | 'sqlite' | 'postgres' | 'cosmosdb' | 'mongodb';

export interface DatabaseConfig {
  provider: DatabaseProvider;
  connectionString?: string;
  database?: string;
  /** Provider-specific options */
  options?: Record<string, unknown>;
}

// ============================================================================
// Pagination Defaults
// ============================================================================

export const PAGINATION_DEFAULTS = {
  THREADS_PAGE_SIZE: 20,
  THREADS_PAGE_SIZE_MAX: 50,
  MESSAGES_PAGE_SIZE: 30,
  MESSAGES_PAGE_SIZE_MAX: 100,
} as const;

// ============================================================================
// Error Types
// ============================================================================

export class ConflictError extends Error {
  constructor(message: string, public readonly currentEtag?: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(public readonly entityType: EntityType, public readonly entityId: string) {
    super(`${entityType} not found: ${entityId}`);
    this.name = 'NotFoundError';
  }
}
