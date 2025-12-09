import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { SSEEvent, SSEEventType } from './types';

/**
 * SSE Service
 *
 * Handles Server-Sent Events formatting and streaming according to RFC 6202.
 * Provides utilities for creating SSE streams from async generators.
 */
@Injectable()
export class SSEService {
  /**
   * Format an SSE event according to RFC 6202 specification
   *
   * Wire format:
   * ```
   * event: eventType
   * data: {"json":"payload"}
   *
   * ```
   *
   * For multiline JSON, each line is prefixed with "data: "
   */
  formatSSE<T>(event: SSEEventType, data: T): string {
    const jsonData = JSON.stringify(data);
    const lines = jsonData.split('\n');
    const formattedData = lines.map((line) => `data: ${line}`).join('\n');
    return `event: ${event}\n${formattedData}\n\n`;
  }

  /**
   * Initialize SSE response headers
   *
   * Sets required headers for SSE streaming:
   * - Content-Type: text/event-stream
   * - Cache-Control: no-cache (prevents caching)
   * - Connection: keep-alive (maintains connection)
   * - X-Accel-Buffering: no (disables nginx buffering)
   */
  initSSEHeaders(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.setHeader('Access-Control-Allow-Origin', '*'); // CORS for testing
    res.flushHeaders();
  }

  /**
   * Create a ReadableStream from an async generator of SSE events
   *
   * This wraps the async generator and handles:
   * - UTF-8 encoding
   * - Abort signal handling
   * - Proper cleanup on cancellation
   */
  async *createSSEStream<T>(source: AsyncIterable<SSEEvent<T>>, signal?: AbortSignal): AsyncGenerator<string> {
    try {
      for await (const event of source) {
        if (signal?.aborted) {
          break;
        }
        yield this.formatSSE(event.event, event.data);
      }
    } catch (error) {
      // Emit error event before closing
      if (!signal?.aborted) {
        yield this.formatSSE('error', {
          error: error instanceof Error ? error.message : 'Unknown error',
          code: 'STREAM_ERROR',
        });
      }
    }
  }

  /**
   * Write SSE events directly to response
   *
   * Use this for simple streaming scenarios where you want to
   * write events one by one to the response.
   */
  writeEvent<T>(res: Response, event: SSEEventType, data: T): void {
    const formatted = this.formatSSE(event, data);
    res.write(formatted);

    // Flush if available (ensures immediate delivery)
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  }

  /**
   * Send a heartbeat comment to keep connection alive
   *
   * SSE spec allows comments starting with ":"
   * Useful for keeping connections alive through proxies
   */
  writeHeartbeat(res: Response): void {
    res.write(': heartbeat\n\n');
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  }
}
