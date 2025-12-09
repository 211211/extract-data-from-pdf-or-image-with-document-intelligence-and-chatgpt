import { AgentsModule } from '../agents/agents.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationStateService } from './services/conversation-state.service';
import { MessageHistoryService } from './services/message-history.service';
import { Module } from '@nestjs/common';
import { StreamingModule } from '../core/streaming/streaming.module';
import { DatabaseModule } from '../database/database.module';
import { UserOwnershipGuard } from '../core/security/user-ownership.guard';

/**
 * Chat Module
 *
 * Provides streaming chat endpoints with multi-turn conversation support.
 *
 * Security:
 * - UserOwnershipGuard validates thread/message ownership
 * - X-User-Id header required for thread operations
 *
 * Endpoints:
 * - POST /chat/stream - Start streaming chat
 * - POST /chat/stop - Stop active stream (works across instances via Redis)
 * - GET /chat/agents - List available agents
 * - GET /chat/threads - List threads for a user
 * - GET /chat/threads/:threadId/messages - Get messages
 * - DELETE /chat/threads/:threadId - Delete thread
 * - GET /chat/status - Service status
 *
 * Services:
 * - ChatService: Core chat processing with optional persistence
 * - MessageHistoryService: Message history management
 * - ConversationStateService: Conversation state tracking
 *
 * Configuration:
 * - DATABASE_PROVIDER: memory | sqlite (for chat history persistence)
 * - SSE_STREAM_STORE_PROVIDER: memory | redis (for cross-instance abort)
 */
@Module({
  imports: [AgentsModule, StreamingModule, DatabaseModule],
  controllers: [ChatController],
  providers: [ChatService, MessageHistoryService, ConversationStateService, UserOwnershipGuard],
  exports: [ChatService, MessageHistoryService, ConversationStateService],
})
export class ChatModule {}
