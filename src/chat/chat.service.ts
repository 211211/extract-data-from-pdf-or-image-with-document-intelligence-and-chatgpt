import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AgentFactory, AgentType } from '../agents/agent.factory';
import { AgentConfig } from '../agents/agent.interface';
import { SSEEvent, AgentContext, ChatMessage } from '../core/streaming/types';
import {
  IChatRepository,
  ChatThread,
  ChatMessageEntity,
  PaginatedResult,
  ThreadQueryOptions,
  MessageQueryOptions,
  UpdateResult,
  ENTITY_TYPES,
} from '../database/types';
import { ChatRequestDto } from './dto/chat-request.dto';

/**
 * Chat Service
 *
 * Orchestrates chat requests with enterprise-grade patterns:
 * - Optimistic concurrency control (ETags)
 * - Soft deletes
 * - Pagination with continuation tokens
 * - High CCU support
 *
 * Stateless design:
 * - No in-memory state
 * - Optional persistence via IChatRepository
 * - Abort handled by StreamAbortService in controller
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly agentFactory: AgentFactory,
    @Optional() @Inject('IChatRepository') private readonly chatRepository?: IChatRepository,
  ) {}

  /**
   * Process a chat request and yield SSE events
   *
   * @param request - Chat request with message history
   * @param signal - AbortSignal for cancellation
   * @yields SSE events from the agent
   */
  async *processChat(request: ChatRequestDto, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
    const traceId = uuidv7();
    const streamId = uuidv7(); // For SSE correlation

    // Build agent context
    const context: AgentContext = {
      traceId,
      userId: request.userId,
      sessionId: request.threadId,
      messageHistory: this.convertMessages(request.messages),
      metadata: {
        conversationStyle: request.conversationStyle,
        streamId,
      },
    };

    // Build agent config
    const config: AgentConfig = {
      maxTokens: request.maxTokens,
      temperature: this.getTemperatureForStyle(request.conversationStyle),
      systemPrompt: request.systemPrompt,
    };

    // Get the appropriate agent
    const agentType = (request.agentType || 'normal') as AgentType;
    const agent = this.agentFactory.getAgent(agentType);

    // Accumulate response for persistence
    let fullResponse = '';

    try {
      for await (const event of agent.run(context, config)) {
        // Check for abort
        if (signal?.aborted) {
          break;
        }

        // Accumulate response content
        if (event.event === 'data') {
          const data = event.data as any;
          fullResponse += data.answer || '';
        }

        yield event;
      }

      // Persist messages if repository is available
      if (this.chatRepository && fullResponse) {
        await this.persistMessages(request, fullResponse, traceId, agentType, streamId);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      yield {
        event: 'error',
        data: {
          error: errorMessage,
          code: 'STREAM_ERROR',
        },
      };
    }
  }

  /**
   * Persist user message and assistant response using upsert (idempotent)
   */
  private async persistMessages(
    request: ChatRequestDto,
    response: string,
    traceId: string,
    agentType: string,
    streamId: string,
  ): Promise<void> {
    if (!this.chatRepository) return;

    try {
      // Ensure thread exists (creates if needed)
      let thread = await this.chatRepository.getThread(request.threadId);
      if (!thread) {
        thread = await this.chatRepository.createThread({
          id: request.threadId,
          userId: request.userId,
          title: this.generateThreadTitle(request.messages),
          metadata: {
            chatType: (request.agentType || 'simple') as any,
            apiVersion: 'v1',
          },
          traceId,
        });
        this.logger.debug(`Created thread ${request.threadId} for user ${request.userId}`);
      }

      // Get the last user message
      const lastUserMsg = request.messages.filter((m) => m.role === 'user').pop();

      if (lastUserMsg) {
        // Upsert user message (idempotent - same ID won't create duplicate)
        await this.chatRepository.upsertMessage({
          id: lastUserMsg.id || uuidv7(),
          threadId: request.threadId,
          userId: request.userId,
          role: 'user',
          content: lastUserMsg.content,
          metadata: {
            traceId,
          },
        });
      }

      // Upsert assistant response
      await this.chatRepository.upsertMessage({
        id: uuidv7(),
        threadId: request.threadId,
        userId: request.userId,
        role: 'assistant',
        content: response,
        metadata: {
          agentType,
          traceId,
          streamId,
          jobStatus: 'completed',
        },
      });

      this.logger.debug(`Persisted messages for thread ${request.threadId}`);
    } catch (error) {
      this.logger.error('Failed to persist messages:', error);
      // Don't throw - persistence failure shouldn't break the stream
    }
  }

  /**
   * Generate a thread title from the first user message
   */
  private generateThreadTitle(messages: ChatRequestDto['messages']): string {
    const firstUser = messages.find((m) => m.role === 'user');
    if (!firstUser) return 'New Chat';

    // Truncate to reasonable length
    const content = firstUser.content;
    return content.length > 50 ? content.substring(0, 47) + '...' : content;
  }

  // -------------------------------------------------------------------------
  // Thread Operations
  // -------------------------------------------------------------------------

  /**
   * Get thread by ID
   */
  async getThread(threadId: string, includeDeleted = false): Promise<ChatThread | null> {
    if (!this.chatRepository) return null;
    return this.chatRepository.getThread(threadId, includeDeleted);
  }

  /**
   * List threads for a user with pagination
   */
  async listThreads(options: ThreadQueryOptions): Promise<PaginatedResult<ChatThread>> {
    if (!this.chatRepository) {
      return { items: [], hasMore: false };
    }
    return this.chatRepository.listThreads(options);
  }

  /**
   * Update thread (title, bookmark, metadata)
   */
  async updateThread(
    threadId: string,
    updates: Partial<Pick<ChatThread, 'title' | 'metadata' | 'isBookmarked'>>,
    etag?: string,
  ): Promise<UpdateResult<ChatThread>> {
    if (!this.chatRepository) {
      return { success: false, error: 'No repository configured' };
    }
    return this.chatRepository.updateThread(threadId, updates, { ifMatch: etag });
  }

  /**
   * Soft delete a thread
   */
  async deleteThread(threadId: string, etag?: string): Promise<UpdateResult<void>> {
    if (!this.chatRepository) {
      return { success: false, error: 'No repository configured' };
    }
    return this.chatRepository.deleteThread(threadId, { ifMatch: etag });
  }

  /**
   * Restore a soft-deleted thread
   */
  async restoreThread(threadId: string, etag?: string): Promise<UpdateResult<ChatThread>> {
    if (!this.chatRepository) {
      return { success: false, error: 'No repository configured' };
    }
    return this.chatRepository.restoreThread(threadId, { ifMatch: etag });
  }

  /**
   * Hard delete a thread (permanent)
   */
  async hardDeleteThread(threadId: string): Promise<boolean> {
    if (!this.chatRepository) return false;
    return this.chatRepository.hardDeleteThread(threadId);
  }

  /**
   * Toggle bookmark status
   */
  async toggleBookmark(threadId: string): Promise<UpdateResult<ChatThread>> {
    if (!this.chatRepository) {
      return { success: false, error: 'No repository configured' };
    }

    const thread = await this.chatRepository.getThread(threadId);
    if (!thread) {
      return { success: false, error: 'Thread not found' };
    }

    return this.chatRepository.updateThread(
      threadId,
      { isBookmarked: !thread.isBookmarked },
      { ifMatch: thread._etag },
    );
  }

  // -------------------------------------------------------------------------
  // Message Operations
  // -------------------------------------------------------------------------

  /**
   * Get messages for a thread with pagination
   */
  async getMessages(threadId: string, options?: MessageQueryOptions): Promise<PaginatedResult<ChatMessageEntity>> {
    if (!this.chatRepository) {
      return { items: [], hasMore: false };
    }
    return this.chatRepository.getMessages(threadId, options);
  }

  /**
   * Get a single message
   */
  async getMessage(messageId: string): Promise<ChatMessageEntity | null> {
    if (!this.chatRepository) return null;
    return this.chatRepository.getMessage(messageId);
  }

  /**
   * Get the last message in a thread
   */
  async getLastMessage(threadId: string): Promise<ChatMessageEntity | null> {
    if (!this.chatRepository) return null;
    return this.chatRepository.getLastMessage(threadId);
  }

  /**
   * Update a message (content or metadata)
   */
  async updateMessage(
    messageId: string,
    updates: Partial<Pick<ChatMessageEntity, 'content' | 'metadata'>>,
    etag?: string,
  ): Promise<UpdateResult<ChatMessageEntity>> {
    if (!this.chatRepository) {
      return { success: false, error: 'No repository configured' };
    }
    return this.chatRepository.updateMessage(messageId, updates, { ifMatch: etag });
  }

  /**
   * Soft delete a message
   */
  async deleteMessage(messageId: string, etag?: string): Promise<UpdateResult<void>> {
    if (!this.chatRepository) {
      return { success: false, error: 'No repository configured' };
    }
    return this.chatRepository.deleteMessage(messageId, { ifMatch: etag });
  }

  /**
   * Count messages in a thread
   */
  async countMessages(threadId: string): Promise<number> {
    if (!this.chatRepository) return 0;
    return this.chatRepository.countMessages(threadId);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert DTO messages to internal format
   */
  private convertMessages(messages: ChatRequestDto['messages']): ChatMessage[] {
    return messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      metadata: msg.metadata as any,
    }));
  }

  /**
   * Map conversation style to temperature
   */
  private getTemperatureForStyle(style?: 'balanced' | 'creative' | 'precise'): number {
    switch (style) {
      case 'creative':
        return 0.9;
      case 'precise':
        return 0.3;
      case 'balanced':
      default:
        return 0.7;
    }
  }

  /**
   * Check if persistence is enabled
   */
  isPersistenceEnabled(): boolean {
    return !!this.chatRepository;
  }
}
