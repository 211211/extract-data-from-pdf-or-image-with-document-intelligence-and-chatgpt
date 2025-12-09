import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { v7 as uuidv7 } from 'uuid';
import { Request, Response } from 'express';

/**
 * Structured Log Entry
 * Consistent format for all log entries
 */
export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  traceId: string;
  spanId?: string;
  userId?: string;
  service: string;
  method: string;
  path: string;
  statusCode?: number;
  duration?: number;
  message: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * LoggingInterceptor
 *
 * Provides structured logging for all HTTP requests with:
 * - Trace ID generation and propagation
 * - Request/response logging
 * - Duration measurement
 * - Error capture with stack traces
 * - User context extraction
 *
 * Trace ID propagation:
 * - Checks for incoming X-Trace-Id or X-Request-Id headers
 * - Generates new trace ID if not present
 * - Adds trace ID to response headers
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly serviceName = process.env.SERVICE_NAME || 'chat-service';

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    // Extract or generate trace ID
    const traceId = this.extractTraceId(request) || uuidv7();
    const spanId = uuidv7().substring(0, 8);

    // Store trace ID in request for downstream use
    (request as any).traceId = traceId;
    (request as any).spanId = spanId;

    // Add trace ID to response headers
    response.setHeader('X-Trace-Id', traceId);
    response.setHeader('X-Span-Id', spanId);

    // Extract user context
    const userId = this.extractUserId(request);

    // Log request
    this.logRequest(request, traceId, spanId, userId);

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logResponse(request, response, traceId, spanId, userId, duration);
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logError(request, response, traceId, spanId, userId, duration, error);
        throw error;
      }),
    );
  }

  private extractTraceId(request: Request): string | undefined {
    return (
      (request.headers['x-trace-id'] as string) ||
      (request.headers['x-request-id'] as string) ||
      (request.headers['traceparent'] as string)?.split('-')[1]
    );
  }

  private extractUserId(request: Request): string | undefined {
    return (
      (request.headers['x-user-id'] as string) ||
      (request as any).user?.id ||
      (request as any).user?.userId ||
      (request.query?.userId as string) ||
      (request.body as any)?.userId
    );
  }

  private logRequest(request: Request, traceId: string, spanId: string, userId?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      traceId,
      spanId,
      userId,
      service: this.serviceName,
      method: request.method,
      path: request.url,
      message: `→ ${request.method} ${request.url}`,
      metadata: {
        userAgent: request.headers['user-agent'],
        contentType: request.headers['content-type'],
        ip: request.ip || request.headers['x-forwarded-for'],
      },
    };

    this.logger.log(JSON.stringify(entry));
  }

  private logResponse(
    request: Request,
    response: Response,
    traceId: string,
    spanId: string,
    userId: string | undefined,
    duration: number,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      traceId,
      spanId,
      userId,
      service: this.serviceName,
      method: request.method,
      path: request.url,
      statusCode: response.statusCode,
      duration,
      message: `← ${request.method} ${request.url} ${response.statusCode} ${duration}ms`,
    };

    this.logger.log(JSON.stringify(entry));
  }

  private logError(
    request: Request,
    response: Response,
    traceId: string,
    spanId: string,
    userId: string | undefined,
    duration: number,
    error: Error,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      traceId,
      spanId,
      userId,
      service: this.serviceName,
      method: request.method,
      path: request.url,
      statusCode: response.statusCode || 500,
      duration,
      message: `✗ ${request.method} ${request.url} ${response.statusCode || 500} ${duration}ms - ${error.message}`,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      },
    };

    this.logger.error(JSON.stringify(entry));
  }
}

/**
 * Helper to get trace context from request
 * Use in services to propagate trace ID
 */
export function getTraceContext(request: any): { traceId: string; spanId?: string } {
  return {
    traceId: request.traceId || uuidv7(),
    spanId: request.spanId,
  };
}

/**
 * Helper to create a child span
 */
export function createChildSpan(parentSpanId?: string): string {
  return uuidv7().substring(0, 8);
}
