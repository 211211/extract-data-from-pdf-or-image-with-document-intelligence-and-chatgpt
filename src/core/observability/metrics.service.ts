import { Injectable, OnModuleInit, Logger } from '@nestjs/common';

/**
 * MetricsService
 *
 * Provides Prometheus-compatible metrics for the chat service.
 * Exposes metrics at /metrics endpoint.
 *
 * Metrics exported:
 * - http_requests_total: Counter of HTTP requests by method, path, status
 * - http_request_duration_seconds: Histogram of request durations
 * - chat_threads_total: Gauge of active chat threads
 * - chat_messages_total: Counter of chat messages by role
 * - chat_streams_active: Gauge of active SSE streams
 * - agent_invocations_total: Counter of agent invocations by type
 * - database_operations_total: Counter of database operations by type
 * - database_operation_duration_seconds: Histogram of database operation durations
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);

  // Counters
  private httpRequestsTotal = new Map<string, number>();
  private chatMessagesTotal = new Map<string, number>();
  private agentInvocationsTotal = new Map<string, number>();
  private databaseOperationsTotal = new Map<string, number>();

  // Gauges
  private chatThreadsTotal = 0;
  private chatStreamsActive = 0;

  // Histograms (buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10)
  private httpRequestDurationBuckets = new Map<string, Map<number, number>>();
  private databaseOperationDurationBuckets = new Map<string, Map<number, number>>();

  private readonly buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

  onModuleInit() {
    this.logger.log('MetricsService initialized');
  }

  // -------------------------------------------------------------------------
  // HTTP Metrics
  // -------------------------------------------------------------------------

  /**
   * Record HTTP request
   */
  recordHttpRequest(method: string, path: string, statusCode: number, durationSeconds: number): void {
    // Normalize path (remove IDs for cardinality control)
    const normalizedPath = this.normalizePath(path);
    const key = `${method}:${normalizedPath}:${statusCode}`;

    // Increment counter
    this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) || 0) + 1);

    // Record duration in histogram
    const histKey = `${method}:${normalizedPath}`;
    if (!this.httpRequestDurationBuckets.has(histKey)) {
      this.httpRequestDurationBuckets.set(histKey, new Map());
      for (const bucket of this.buckets) {
        this.httpRequestDurationBuckets.get(histKey)!.set(bucket, 0);
      }
      this.httpRequestDurationBuckets.get(histKey)!.set(Infinity, 0); // +Inf bucket
    }

    const histBuckets = this.httpRequestDurationBuckets.get(histKey)!;
    for (const bucket of [...this.buckets, Infinity]) {
      if (durationSeconds <= bucket) {
        histBuckets.set(bucket, (histBuckets.get(bucket) || 0) + 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Chat Metrics
  // -------------------------------------------------------------------------

  /**
   * Increment thread count
   */
  incrementThreadCount(): void {
    this.chatThreadsTotal++;
  }

  /**
   * Decrement thread count
   */
  decrementThreadCount(): void {
    this.chatThreadsTotal = Math.max(0, this.chatThreadsTotal - 1);
  }

  /**
   * Set thread count
   */
  setThreadCount(count: number): void {
    this.chatThreadsTotal = count;
  }

  /**
   * Record chat message
   */
  recordChatMessage(role: 'user' | 'assistant' | 'system', agentType?: string): void {
    const key = `${role}:${agentType || 'unknown'}`;
    this.chatMessagesTotal.set(key, (this.chatMessagesTotal.get(key) || 0) + 1);
  }

  /**
   * Increment active streams
   */
  incrementActiveStreams(): void {
    this.chatStreamsActive++;
  }

  /**
   * Decrement active streams
   */
  decrementActiveStreams(): void {
    this.chatStreamsActive = Math.max(0, this.chatStreamsActive - 1);
  }

  /**
   * Get active streams count
   */
  getActiveStreams(): number {
    return this.chatStreamsActive;
  }

  // -------------------------------------------------------------------------
  // Agent Metrics
  // -------------------------------------------------------------------------

  /**
   * Record agent invocation
   */
  recordAgentInvocation(agentType: string, success: boolean): void {
    const key = `${agentType}:${success ? 'success' : 'failure'}`;
    this.agentInvocationsTotal.set(key, (this.agentInvocationsTotal.get(key) || 0) + 1);
  }

  // -------------------------------------------------------------------------
  // Database Metrics
  // -------------------------------------------------------------------------

  /**
   * Record database operation
   */
  recordDatabaseOperation(operation: string, collection: string, durationSeconds: number, success: boolean): void {
    const key = `${operation}:${collection}:${success ? 'success' : 'failure'}`;
    this.databaseOperationsTotal.set(key, (this.databaseOperationsTotal.get(key) || 0) + 1);

    // Record duration in histogram
    const histKey = `${operation}:${collection}`;
    if (!this.databaseOperationDurationBuckets.has(histKey)) {
      this.databaseOperationDurationBuckets.set(histKey, new Map());
      for (const bucket of this.buckets) {
        this.databaseOperationDurationBuckets.get(histKey)!.set(bucket, 0);
      }
      this.databaseOperationDurationBuckets.get(histKey)!.set(Infinity, 0);
    }

    const histBuckets = this.databaseOperationDurationBuckets.get(histKey)!;
    for (const bucket of [...this.buckets, Infinity]) {
      if (durationSeconds <= bucket) {
        histBuckets.set(bucket, (histBuckets.get(bucket) || 0) + 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Prometheus Export
  // -------------------------------------------------------------------------

  /**
   * Generate Prometheus metrics output
   */
  getMetrics(): string {
    const lines: string[] = [];

    // HTTP Requests Total
    lines.push('# HELP http_requests_total Total number of HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, value] of this.httpRequestsTotal) {
      const [method, path, status] = key.split(':');
      lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${value}`);
    }

    // HTTP Request Duration
    lines.push('# HELP http_request_duration_seconds HTTP request duration in seconds');
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [key, buckets] of this.httpRequestDurationBuckets) {
      const [method, path] = key.split(':');
      for (const [bucket, count] of buckets) {
        const le = bucket === Infinity ? '+Inf' : bucket.toString();
        lines.push(`http_request_duration_seconds_bucket{method="${method}",path="${path}",le="${le}"} ${count}`);
      }
    }

    // Chat Threads Total
    lines.push('# HELP chat_threads_total Total number of chat threads');
    lines.push('# TYPE chat_threads_total gauge');
    lines.push(`chat_threads_total ${this.chatThreadsTotal}`);

    // Chat Messages Total
    lines.push('# HELP chat_messages_total Total number of chat messages');
    lines.push('# TYPE chat_messages_total counter');
    for (const [key, value] of this.chatMessagesTotal) {
      const [role, agentType] = key.split(':');
      lines.push(`chat_messages_total{role="${role}",agent_type="${agentType}"} ${value}`);
    }

    // Chat Streams Active
    lines.push('# HELP chat_streams_active Number of active SSE streams');
    lines.push('# TYPE chat_streams_active gauge');
    lines.push(`chat_streams_active ${this.chatStreamsActive}`);

    // Agent Invocations Total
    lines.push('# HELP agent_invocations_total Total number of agent invocations');
    lines.push('# TYPE agent_invocations_total counter');
    for (const [key, value] of this.agentInvocationsTotal) {
      const [agentType, result] = key.split(':');
      lines.push(`agent_invocations_total{agent_type="${agentType}",result="${result}"} ${value}`);
    }

    // Database Operations Total
    lines.push('# HELP database_operations_total Total number of database operations');
    lines.push('# TYPE database_operations_total counter');
    for (const [key, value] of this.databaseOperationsTotal) {
      const [operation, collection, result] = key.split(':');
      lines.push(
        `database_operations_total{operation="${operation}",collection="${collection}",result="${result}"} ${value}`,
      );
    }

    // Database Operation Duration
    lines.push('# HELP database_operation_duration_seconds Database operation duration in seconds');
    lines.push('# TYPE database_operation_duration_seconds histogram');
    for (const [key, buckets] of this.databaseOperationDurationBuckets) {
      const [operation, collection] = key.split(':');
      for (const [bucket, count] of buckets) {
        const le = bucket === Infinity ? '+Inf' : bucket.toString();
        lines.push(
          `database_operation_duration_seconds_bucket{operation="${operation}",collection="${collection}",le="${le}"} ${count}`,
        );
      }
    }

    return lines.join('\n') + '\n';
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Normalize path for cardinality control
   * Replaces UUIDs and numeric IDs with placeholders
   */
  private normalizePath(path: string): string {
    return path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id') // UUID
      .replace(/\/[0-9]+/g, '/:id') // Numeric ID
      .replace(/\?.*$/, ''); // Remove query string
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    this.httpRequestsTotal.clear();
    this.chatMessagesTotal.clear();
    this.agentInvocationsTotal.clear();
    this.databaseOperationsTotal.clear();
    this.httpRequestDurationBuckets.clear();
    this.databaseOperationDurationBuckets.clear();
    this.chatThreadsTotal = 0;
    this.chatStreamsActive = 0;
  }
}
