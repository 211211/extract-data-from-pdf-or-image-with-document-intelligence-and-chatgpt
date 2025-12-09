/**
 * SSE Streaming Types
 *
 * Defines the contract for Server-Sent Events used in multi-turn agent streaming.
 * Based on production patterns from modec-azure-chatgpt and sensei-server.
 */

// ============================================================================
// SSE Event Types
// ============================================================================

export type SSEEventType = 'metadata' | 'agent_updated' | 'data' | 'done' | 'error';

export interface SSEEvent<T = unknown> {
  event: SSEEventType;
  data: T;
}

// ============================================================================
// Event Payloads
// ============================================================================

/**
 * Metadata event payload - sent at the start of a stream
 */
export interface MetadataPayload {
  trace_id: string;
  citations?: Citation[];
  filter_hint?: FilterHint;
  run_id?: string; // For async jobs (e.g., deep_research)
  thread_id?: string; // For async jobs
  stream_id?: string; // For stream resumption
}

/**
 * Agent updated event payload - indicates agent status changes
 */
export interface AgentUpdatedPayload {
  answer: string; // Agent name or status message
  content_type: ContentType;
  job_description?: string; // Human-readable description of what agent is doing
}

/**
 * Data event payload - streaming content chunks
 */
export interface DataPayload {
  answer: string; // Content chunk
}

/**
 * Done event payload - indicates stream completion
 */
export interface DonePayload {
  message_id?: string; // Persisted message ID (e.g., from Cosmos DB)
  stream_id?: string; // Stream store ID for resumption
  answer?: string; // Final status message
}

/**
 * Error event payload - indicates an error occurred
 */
export interface ErrorPayload {
  error: string;
  code?: ErrorCode;
  details?: unknown;
}

// ============================================================================
// Supporting Types
// ============================================================================

export type ContentType = 'thoughts' | 'final_answer';

export type ErrorCode =
  | 'STREAM_ERROR'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'AGENT_ERROR'
  | 'UPSTREAM_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'INTERNAL_ERROR';

export interface Citation {
  title: string;
  url?: string;
  snippet?: string;
  source?: string;
  page?: number;
}

export interface FilterHint {
  projectCode?: string;
  disciplineCodeList?: string[];
  documentTypes?: string[];
}

// ============================================================================
// Stream Store Types
// ============================================================================

export interface StreamSession {
  threadId: string;
  streamId: string;
  chunks: StreamChunk[];
  isDone: boolean;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StreamChunk {
  agent: string;
  content: string;
  contentType: ContentType;
  timestamp: Date;
}

export interface IStreamStore {
  /**
   * Initialize a new stream session
   * @returns streamId - unique identifier for the stream
   */
  initSession(threadId: string): Promise<string>;

  /**
   * Append a chunk to the stream session
   * Merges consecutive chunks from the same agent
   */
  appendChunk(threadId: string, chunk: StreamChunk): Promise<void>;

  /**
   * Mark the stream as complete
   */
  markDone(threadId: string, messageId?: string): Promise<void>;

  /**
   * Mark the stream as failed
   */
  markError(threadId: string, error: string): Promise<void>;

  /**
   * Get the current session data
   */
  getSession(threadId: string): Promise<StreamSession | null>;

  /**
   * Get chunks added after a specific index (for resumption)
   */
  getChunksAfter(threadId: string, afterIndex: number): Promise<StreamChunk[]>;

  /**
   * Clean up a session
   */
  cleanup(threadId: string): Promise<void>;
}

// ============================================================================
// Agent Types
// ============================================================================

export interface AgentContext {
  traceId: string;
  userId: string;
  sessionId: string; // Thread ID
  messageHistory: ChatMessage[];
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: MessageMetadata;
  attachments?: Attachment[];
}

export interface MessageMetadata {
  tool?: string;
  run_id?: string;
  thread_id?: string;
  stream_id?: string;
  status?: 'pending' | 'streaming' | 'complete' | 'error';
}

export interface Attachment {
  job_id: string;
  file_name: string;
  ingestion_status?: string;
  content_size?: number;
  mime_type?: string;
}

// ============================================================================
// Intermediate Steps (for multi-agent visibility)
// ============================================================================

export interface IntermediateStep {
  agent: string;
  content: string;
  contentType: ContentType;
  jobDescription?: string;
  timestamp?: Date;
}
