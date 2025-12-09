import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SSEService } from './sse.service';
import { StreamAbortService } from './stream-abort.service';

/**
 * Streaming Module
 *
 * Provides SSE streaming infrastructure globally.
 * Stateless design for horizontal scaling:
 * - SSEService: Pure utility functions for SSE formatting
 * - StreamAbortService: Cross-instance abort via Redis Pub/Sub
 *
 * Configuration:
 * - SSE_STREAM_STORE_PROVIDER=memory: Local abort only (single instance)
 * - SSE_STREAM_STORE_PROVIDER=redis: Cross-instance abort via Redis Pub/Sub
 *
 * Note: Chat history persistence is handled by DatabaseModule (IChatRepository).
 * This module only handles real-time streaming concerns.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [SSEService, StreamAbortService],
  exports: [SSEService, StreamAbortService],
})
export class StreamingModule {}
