import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Res,
  Headers,
  HttpStatus,
  HttpCode,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  UseGuards,
  Inject,
  Optional,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiProduces, ApiParam, ApiQuery, ApiHeader } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { SSEService } from '../core/streaming/sse.service';
import { StreamAbortService } from '../core/streaming/stream-abort.service';
import { ChatRequestDto, StopStreamDto } from './dto/chat-request.dto';
import {
  PaginatedResult,
  ChatThread,
  ChatMessageEntity,
  PAGINATION_DEFAULTS,
  IChatRepository,
} from '../database/types';
import { UserOwnershipGuard, RequireOwnership } from '../core/security/user-ownership.guard';

/**
 * Chat Controller
 *
 * Enterprise-grade chat endpoints with:
 * - Optimistic concurrency control (ETags via If-Match header)
 * - Soft deletes with restore capability
 * - Continuation token pagination
 * - Cross-instance stream abort via Redis Pub/Sub
 *
 * Endpoints:
 * - POST /chat/stream - Start streaming chat
 * - POST /chat/stop - Stop active stream
 * - GET /chat/agents - List available agents
 * - GET /chat/threads - List threads with pagination
 * - GET /chat/threads/:threadId - Get thread details
 * - PATCH /chat/threads/:threadId - Update thread
 * - DELETE /chat/threads/:threadId - Soft delete thread
 * - POST /chat/threads/:threadId/restore - Restore deleted thread
 * - DELETE /chat/threads/:threadId/permanent - Hard delete thread
 * - GET /chat/threads/:threadId/messages - Get messages with pagination
 * - POST /chat/threads/:threadId/bookmark - Toggle bookmark
 * - GET /chat/status - Service status
 */
@ApiTags('Chat')
@Controller('chat')
@UseGuards(UserOwnershipGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly sseService: SSEService,
    private readonly streamAbortService: StreamAbortService,
    @Optional() @Inject('IChatRepository') private readonly chatRepository?: IChatRepository,
  ) {}

  // -------------------------------------------------------------------------
  // Security Helper
  // -------------------------------------------------------------------------

  /**
   * Validate that the requesting user owns the thread
   * @throws ForbiddenException if user doesn't own the thread
   */
  private async validateThreadOwnership(threadId: string, requestUserId: string): Promise<ChatThread> {
    if (!this.chatRepository) {
      const thread = await this.chatService.getThread(threadId);
      if (!thread) {
        throw new NotFoundException('Thread not found');
      }
      return thread;
    }

    const thread = await this.chatRepository.getThread(threadId, true);
    if (!thread) {
      throw new NotFoundException('Thread not found');
    }

    if (thread.userId !== requestUserId) {
      throw new ForbiddenException('You do not have access to this thread');
    }

    return thread;
  }

  // -------------------------------------------------------------------------
  // Streaming Endpoints
  // -------------------------------------------------------------------------

  /**
   * Stream chat response
   */
  @Post('stream')
  @ApiOperation({
    summary: 'Stream chat response',
    description: 'Start a streaming chat session using SSE',
  })
  @ApiProduces('text/event-stream')
  @ApiResponse({ status: 200, description: 'SSE stream of chat events' })
  async streamChat(@Body() request: ChatRequestDto, @Res() res: Response): Promise<void> {
    this.sseService.initSSEHeaders(res);

    const abortController = await this.streamAbortService.registerStream(request.threadId);

    try {
      const stream = this.chatService.processChat(request, abortController.signal);

      for await (const event of stream) {
        if (abortController.signal.aborted) break;
        this.sseService.writeEvent(res, event.event, event.data);
      }
    } catch (error) {
      this.sseService.writeEvent(res, 'error', {
        error: error instanceof Error ? error.message : 'Stream failed',
        code: 'STREAM_ERROR',
      });
    } finally {
      await this.streamAbortService.unregisterStream(request.threadId);
      res.end();
    }
  }

  /**
   * Stop an active stream
   */
  @Post('stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop active stream',
    description: 'Abort an active streaming session (works across instances via Redis)',
  })
  @ApiResponse({ status: 200, description: 'Stream stop result' })
  async stopStream(@Body() body: StopStreamDto): Promise<{ success: boolean; message: string }> {
    const stopped = await this.streamAbortService.requestAbort(body.threadId);
    return stopped
      ? { success: true, message: 'Stream stop signal sent' }
      : { success: false, message: 'No active stream found for this thread' };
  }

  // -------------------------------------------------------------------------
  // Agent Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get available agents
   */
  @Get('agents')
  @ApiOperation({ summary: 'List available agents' })
  getAvailableAgents(): { agents: string[] } {
    return { agents: ['normal', 'rag', 'multi-agent'] };
  }

  // -------------------------------------------------------------------------
  // Thread Endpoints
  // -------------------------------------------------------------------------

  /**
   * List threads for a user with pagination
   */
  @Get('threads')
  @ApiOperation({
    summary: 'List chat threads',
    description: 'Get paginated list of chat threads with continuation token',
  })
  @ApiQuery({ name: 'userId', required: true, description: 'User ID' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max threads per page (default: 20, max: 50)' })
  @ApiQuery({ name: 'continuationToken', required: false, description: 'Token for next page' })
  @ApiQuery({ name: 'isBookmarked', required: false, description: 'Filter by bookmark status' })
  @ApiQuery({ name: 'includeDeleted', required: false, description: 'Include soft-deleted threads' })
  @ApiResponse({ status: 200, description: 'Paginated list of threads' })
  async listThreads(
    @Query('userId') userId: string,
    @Query('limit') limit?: number,
    @Query('continuationToken') continuationToken?: string,
    @Query('isBookmarked') isBookmarked?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ): Promise<PaginatedResult<ChatThread>> {
    return this.chatService.listThreads({
      userId,
      limit: limit ? Math.min(Number(limit), PAGINATION_DEFAULTS.THREADS_PAGE_SIZE_MAX) : undefined,
      continuationToken,
      isBookmarked: isBookmarked === 'true' ? true : isBookmarked === 'false' ? false : undefined,
      includeDeleted: includeDeleted === 'true',
    });
  }

  /**
   * Get thread by ID
   * Validates that the requesting user owns the thread
   */
  @Get('threads/:threadId')
  @ApiOperation({ summary: 'Get thread details' })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'User ID for ownership validation' })
  @ApiResponse({ status: 200, description: 'Thread details' })
  @ApiResponse({ status: 403, description: 'Forbidden - not thread owner' })
  @ApiResponse({ status: 404, description: 'Thread not found' })
  @RequireOwnership('threadId')
  async getThread(@Param('threadId') threadId: string, @Headers('X-User-Id') userId: string): Promise<ChatThread> {
    // Ownership is validated by the guard, but we do an explicit check here for extra safety
    const thread = await this.validateThreadOwnership(threadId, userId);
    if (thread.isDeleted) {
      throw new NotFoundException('Thread not found');
    }
    return thread;
  }

  /**
   * Update thread (title, metadata, bookmark)
   * Validates that the requesting user owns the thread
   */
  @Patch('threads/:threadId')
  @ApiOperation({
    summary: 'Update thread',
    description: 'Update thread with optimistic concurrency control',
  })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'User ID for ownership validation' })
  @ApiHeader({ name: 'If-Match', required: false, description: 'ETag for optimistic concurrency' })
  @ApiResponse({ status: 200, description: 'Updated thread' })
  @ApiResponse({ status: 403, description: 'Forbidden - not thread owner' })
  @ApiResponse({ status: 404, description: 'Thread not found' })
  @ApiResponse({ status: 409, description: 'Conflict - ETag mismatch' })
  @RequireOwnership('threadId')
  async updateThread(
    @Param('threadId') threadId: string,
    @Body() updates: { title?: string; isBookmarked?: boolean; metadata?: Record<string, unknown> },
    @Headers('X-User-Id') userId: string,
    @Headers('If-Match') ifMatch?: string,
  ): Promise<{ thread: ChatThread; etag: string }> {
    // Validate ownership first
    await this.validateThreadOwnership(threadId, userId);

    const result = await this.chatService.updateThread(threadId, updates, ifMatch);

    if (!result.success) {
      if (result.conflict) {
        throw new ConflictException('Thread was modified by another request. Please refresh and try again.');
      }
      throw new NotFoundException(result.error || 'Thread not found');
    }

    return {
      thread: result.entity!,
      etag: result.newEtag!,
    };
  }

  /**
   * Soft delete a thread
   * Validates that the requesting user owns the thread
   */
  @Delete('threads/:threadId')
  @ApiOperation({
    summary: 'Delete thread (soft)',
    description: 'Soft delete a thread - can be restored',
  })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'User ID for ownership validation' })
  @ApiHeader({ name: 'If-Match', required: false, description: 'ETag for optimistic concurrency' })
  @ApiResponse({ status: 200, description: 'Thread deleted' })
  @ApiResponse({ status: 403, description: 'Forbidden - not thread owner' })
  @ApiResponse({ status: 404, description: 'Thread not found' })
  @ApiResponse({ status: 409, description: 'Conflict - ETag mismatch' })
  @RequireOwnership('threadId')
  async deleteThread(
    @Param('threadId') threadId: string,
    @Headers('X-User-Id') userId: string,
    @Headers('If-Match') ifMatch?: string,
  ): Promise<{ success: boolean; message: string }> {
    // Validate ownership first
    await this.validateThreadOwnership(threadId, userId);

    const result = await this.chatService.deleteThread(threadId, ifMatch);

    if (!result.success) {
      if (result.conflict) {
        throw new ConflictException('Thread was modified. Please refresh and try again.');
      }
      throw new NotFoundException(result.error || 'Thread not found');
    }

    return { success: true, message: 'Thread deleted (can be restored)' };
  }

  /**
   * Restore a soft-deleted thread
   * Validates that the requesting user owns the thread
   */
  @Post('threads/:threadId/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore deleted thread',
    description: 'Restore a soft-deleted thread',
  })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'User ID for ownership validation' })
  @ApiHeader({ name: 'If-Match', required: false, description: 'ETag for optimistic concurrency' })
  @ApiResponse({ status: 200, description: 'Thread restored' })
  @ApiResponse({ status: 403, description: 'Forbidden - not thread owner' })
  @ApiResponse({ status: 404, description: 'Thread not found' })
  @RequireOwnership('threadId')
  async restoreThread(
    @Param('threadId') threadId: string,
    @Headers('X-User-Id') userId: string,
    @Headers('If-Match') ifMatch?: string,
  ): Promise<{ thread: ChatThread; etag: string }> {
    // Validate ownership first (use includeDeleted since we're restoring)
    await this.validateThreadOwnership(threadId, userId);

    const result = await this.chatService.restoreThread(threadId, ifMatch);

    if (!result.success) {
      if (result.conflict) {
        throw new ConflictException('Thread was modified. Please refresh and try again.');
      }
      throw new NotFoundException(result.error || 'Thread not found');
    }

    return {
      thread: result.entity!,
      etag: result.newEtag!,
    };
  }

  /**
   * Hard delete a thread (permanent)
   * Validates that the requesting user owns the thread
   */
  @Delete('threads/:threadId/permanent')
  @ApiOperation({
    summary: 'Delete thread (permanent)',
    description: 'Permanently delete a thread - cannot be undone',
  })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'User ID for ownership validation' })
  @ApiResponse({ status: 200, description: 'Thread permanently deleted' })
  @ApiResponse({ status: 403, description: 'Forbidden - not thread owner' })
  @ApiResponse({ status: 404, description: 'Thread not found' })
  @RequireOwnership('threadId')
  async hardDeleteThread(
    @Param('threadId') threadId: string,
    @Headers('X-User-Id') userId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Validate ownership first
    await this.validateThreadOwnership(threadId, userId);

    const deleted = await this.chatService.hardDeleteThread(threadId);
    if (!deleted) {
      throw new NotFoundException('Thread not found');
    }
    return { success: true, message: 'Thread permanently deleted' };
  }

  /**
   * Toggle bookmark status
   * Validates that the requesting user owns the thread
   */
  @Post('threads/:threadId/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle bookmark',
    description: 'Toggle the bookmark status of a thread',
  })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'User ID for ownership validation' })
  @ApiResponse({ status: 200, description: 'Bookmark toggled' })
  @ApiResponse({ status: 403, description: 'Forbidden - not thread owner' })
  @ApiResponse({ status: 404, description: 'Thread not found' })
  @RequireOwnership('threadId')
  async toggleBookmark(
    @Param('threadId') threadId: string,
    @Headers('X-User-Id') userId: string,
  ): Promise<{ thread: ChatThread; isBookmarked: boolean }> {
    // Validate ownership first
    await this.validateThreadOwnership(threadId, userId);

    const result = await this.chatService.toggleBookmark(threadId);

    if (!result.success) {
      throw new NotFoundException(result.error || 'Thread not found');
    }

    return {
      thread: result.entity!,
      isBookmarked: result.entity!.isBookmarked || false,
    };
  }

  // -------------------------------------------------------------------------
  // Message Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get messages for a thread with pagination
   * Validates that the requesting user owns the thread
   */
  @Get('threads/:threadId/messages')
  @ApiOperation({
    summary: 'Get thread messages',
    description: 'Get paginated messages in a chat thread',
  })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'User ID for ownership validation' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max messages per page (default: 30, max: 100)' })
  @ApiQuery({ name: 'continuationToken', required: false, description: 'Token for next page' })
  @ApiQuery({ name: 'role', required: false, description: 'Filter by role (user/assistant/system)' })
  @ApiResponse({ status: 200, description: 'Paginated list of messages' })
  @ApiResponse({ status: 403, description: 'Forbidden - not thread owner' })
  @RequireOwnership('threadId')
  async getThreadMessages(
    @Param('threadId') threadId: string,
    @Headers('X-User-Id') userId: string,
    @Query('limit') limit?: number,
    @Query('continuationToken') continuationToken?: string,
    @Query('role') role?: 'user' | 'assistant' | 'system',
  ): Promise<PaginatedResult<ChatMessageEntity>> {
    // Validate ownership first
    await this.validateThreadOwnership(threadId, userId);

    return this.chatService.getMessages(threadId, {
      limit: limit ? Math.min(Number(limit), PAGINATION_DEFAULTS.MESSAGES_PAGE_SIZE_MAX) : undefined,
      continuationToken,
      role,
    });
  }

  /**
   * Get last message in a thread
   * Validates that the requesting user owns the thread
   */
  @Get('threads/:threadId/messages/last')
  @ApiOperation({ summary: 'Get last message' })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'User ID for ownership validation' })
  @ApiResponse({ status: 200, description: 'Last message' })
  @ApiResponse({ status: 403, description: 'Forbidden - not thread owner' })
  @ApiResponse({ status: 404, description: 'No messages found' })
  @RequireOwnership('threadId')
  async getLastMessage(
    @Param('threadId') threadId: string,
    @Headers('X-User-Id') userId: string,
  ): Promise<ChatMessageEntity> {
    // Validate ownership first
    await this.validateThreadOwnership(threadId, userId);

    const message = await this.chatService.getLastMessage(threadId);
    if (!message) {
      throw new NotFoundException('No messages found in thread');
    }
    return message;
  }

  /**
   * Get message count for a thread
   * Validates that the requesting user owns the thread
   */
  @Get('threads/:threadId/messages/count')
  @ApiOperation({ summary: 'Get message count' })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'User ID for ownership validation' })
  @ApiResponse({ status: 200, description: 'Message count' })
  @ApiResponse({ status: 403, description: 'Forbidden - not thread owner' })
  @RequireOwnership('threadId')
  async getMessageCount(
    @Param('threadId') threadId: string,
    @Headers('X-User-Id') userId: string,
  ): Promise<{ count: number }> {
    // Validate ownership first
    await this.validateThreadOwnership(threadId, userId);

    const count = await this.chatService.countMessages(threadId);
    return { count };
  }

  // -------------------------------------------------------------------------
  // Status Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get streaming service status
   */
  @Get('status')
  @ApiOperation({
    summary: 'Get service status',
    description: 'Check streaming and persistence status',
  })
  @ApiResponse({ status: 200, description: 'Service status' })
  getStatus(): {
    activeStreams: number;
    redisEnabled: boolean;
    persistenceEnabled: boolean;
  } {
    return {
      activeStreams: this.streamAbortService.getActiveStreamCount(),
      redisEnabled: this.streamAbortService.isRedisConnected(),
      persistenceEnabled: this.chatService.isPersistenceEnabled(),
    };
  }
}
