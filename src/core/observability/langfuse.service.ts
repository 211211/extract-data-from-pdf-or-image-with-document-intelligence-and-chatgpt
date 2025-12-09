import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Langfuse } from 'langfuse';

/**
 * Langfuse configuration interface
 */
export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  enabled: boolean;
  flushAt?: number;
  flushInterval?: number;
}

/**
 * Model parameters type (Langfuse SDK requirement)
 */
export type ModelParameters = {
  [key: string]: string | number | boolean | string[];
};

/**
 * Generation parameters for LLM calls
 */
export interface GenerationParams {
  name: string;
  model: string;
  modelParameters?: ModelParameters;
  input: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Generation update parameters
 */
export interface GenerationUpdate {
  output?: unknown;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    unit?: 'TOKENS' | 'CHARACTERS' | 'MILLISECONDS' | 'SECONDS' | 'IMAGES';
  };
  metadata?: Record<string, unknown>;
  level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
  statusMessage?: string;
}

/**
 * Span parameters for generic operations
 */
export interface SpanParams {
  name: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * LangfuseService
 *
 * Provides LLM observability using Langfuse (self-hosted MIT version).
 * Features:
 * - Trace creation and management
 * - Generation tracking for LLM calls
 * - Span tracking for operations
 * - Token usage tracking
 * - Cost calculation
 *
 * Configuration via environment variables:
 * - LANGFUSE_PUBLIC_KEY
 * - LANGFUSE_SECRET_KEY
 * - LANGFUSE_BASE_URL (default: http://localhost:3000 for self-hosted)
 * - LANGFUSE_ENABLED (default: true if keys are set)
 */
@Injectable()
export class LangfuseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LangfuseService.name);
  private langfuse: Langfuse | null = null;
  private config: LangfuseConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig();
  }

  private loadConfig(): LangfuseConfig {
    const publicKey = this.configService.get<string>('LANGFUSE_PUBLIC_KEY', '');
    const secretKey = this.configService.get<string>('LANGFUSE_SECRET_KEY', '');
    const baseUrl = this.configService.get<string>('LANGFUSE_BASE_URL', 'http://localhost:3000');
    const enabled = this.configService.get<string>('LANGFUSE_ENABLED', 'true') === 'true' && !!publicKey && !!secretKey;
    const flushAt = this.configService.get<number>('LANGFUSE_FLUSH_AT', 15);
    const flushInterval = this.configService.get<number>('LANGFUSE_FLUSH_INTERVAL', 10000);

    return {
      publicKey,
      secretKey,
      baseUrl,
      enabled,
      flushAt,
      flushInterval,
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log('Langfuse disabled (missing credentials or LANGFUSE_ENABLED=false)');
      return;
    }

    try {
      this.langfuse = new Langfuse({
        publicKey: this.config.publicKey,
        secretKey: this.config.secretKey,
        baseUrl: this.config.baseUrl,
        flushAt: this.config.flushAt,
        flushInterval: this.config.flushInterval,
      });

      this.logger.log(`Langfuse initialized (baseUrl: ${this.config.baseUrl})`);
    } catch (error) {
      this.logger.error('Failed to initialize Langfuse', error);
      this.langfuse = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.langfuse) {
      try {
        await this.langfuse.shutdownAsync();
        this.logger.log('Langfuse shutdown complete');
      } catch (error) {
        this.logger.error('Error during Langfuse shutdown', error);
      }
    }
  }

  /**
   * Check if Langfuse is enabled and initialized
   */
  isEnabled(): boolean {
    return this.config.enabled && this.langfuse !== null;
  }

  /**
   * Get the Langfuse instance for direct access
   */
  getInstance(): Langfuse | null {
    return this.langfuse;
  }

  /**
   * Create a new trace for a conversation/request
   *
   * @param traceId - Unique trace ID (use existing traceId from AgentContext)
   * @param name - Name of the trace (e.g., 'chat', 'rag-query')
   * @param userId - User identifier
   * @param sessionId - Session/thread identifier
   * @param metadata - Additional metadata
   */
  createTrace(
    traceId: string,
    name: string,
    options?: {
      userId?: string;
      sessionId?: string;
      metadata?: Record<string, unknown>;
      tags?: string[];
      input?: unknown;
    },
  ) {
    if (!this.langfuse) return null;

    try {
      return this.langfuse.trace({
        id: traceId,
        name,
        userId: options?.userId,
        sessionId: options?.sessionId,
        metadata: options?.metadata,
        tags: options?.tags,
        input: options?.input,
      });
    } catch (error) {
      this.logger.error('Failed to create trace', error);
      return null;
    }
  }

  /**
   * Create a generation (LLM call) within a trace
   *
   * @param traceId - Parent trace ID
   * @param params - Generation parameters
   */
  createGeneration(traceId: string, params: GenerationParams) {
    if (!this.langfuse) return null;

    try {
      const trace = this.langfuse.trace({ id: traceId });
      return trace.generation({
        name: params.name,
        model: params.model,
        modelParameters: params.modelParameters,
        input: params.input,
        metadata: params.metadata,
      });
    } catch (error) {
      this.logger.error('Failed to create generation', error);
      return null;
    }
  }

  /**
   * Create a span (generic operation) within a trace
   *
   * @param traceId - Parent trace ID
   * @param params - Span parameters
   */
  createSpan(traceId: string, params: SpanParams) {
    if (!this.langfuse) return null;

    try {
      const trace = this.langfuse.trace({ id: traceId });
      return trace.span({
        name: params.name,
        input: params.input,
        metadata: params.metadata,
      });
    } catch (error) {
      this.logger.error('Failed to create span', error);
      return null;
    }
  }

  /**
   * Update a trace with output/metadata
   *
   * @param traceId - Trace ID to update
   * @param update - Update parameters
   */
  updateTrace(
    traceId: string,
    update: {
      output?: unknown;
      metadata?: Record<string, unknown>;
      tags?: string[];
    },
  ) {
    if (!this.langfuse) return;

    try {
      const trace = this.langfuse.trace({ id: traceId });
      trace.update(update);
    } catch (error) {
      this.logger.error('Failed to update trace', error);
    }
  }

  /**
   * Score a trace (user feedback, quality metrics)
   *
   * @param traceId - Trace ID to score
   * @param name - Score name (e.g., 'user-feedback', 'quality')
   * @param value - Score value (0-1 for normalized scores)
   * @param comment - Optional comment
   */
  scoreTrace(traceId: string, name: string, value: number, comment?: string) {
    if (!this.langfuse) return;

    try {
      this.langfuse.score({
        traceId,
        name,
        value,
        comment,
      });
    } catch (error) {
      this.logger.error('Failed to score trace', error);
    }
  }

  /**
   * Flush all pending events to Langfuse
   * Call this before application shutdown or at strategic points
   */
  async flush(): Promise<void> {
    if (!this.langfuse) return;

    try {
      await this.langfuse.flushAsync();
    } catch (error) {
      this.logger.error('Failed to flush Langfuse events', error);
    }
  }

  /**
   * Helper: Create a traced LLM generation with automatic timing
   *
   * Usage:
   * ```typescript
   * const { generation, end } = langfuseService.startGeneration(traceId, {
   *   name: 'chat-completion',
   *   model: 'gpt-5.1',
   *   input: messages,
   * });
   *
   * // ... make LLM call ...
   *
   * end({
   *   output: response,
   *   usage: { input: 100, output: 50 }
   * });
   * ```
   */
  startGeneration(
    traceId: string,
    params: GenerationParams,
  ): {
    generation: ReturnType<typeof this.createGeneration>;
    end: (update: GenerationUpdate) => void;
  } {
    const generation = this.createGeneration(traceId, params);
    const startTime = Date.now();

    return {
      generation,
      end: (update: GenerationUpdate) => {
        if (generation) {
          try {
            generation.end({
              ...update,
              completionStartTime: new Date(startTime),
            });
          } catch (error) {
            this.logger.error('Failed to end generation', error);
          }
        }
      },
    };
  }

  /**
   * Helper: Create a traced span with automatic timing
   *
   * Usage:
   * ```typescript
   * const { span, end } = langfuseService.startSpan(traceId, {
   *   name: 'document-search',
   *   input: { query: 'example' },
   * });
   *
   * // ... perform operation ...
   *
   * end({ output: results });
   * ```
   */
  startSpan(
    traceId: string,
    params: SpanParams,
  ): {
    span: ReturnType<typeof this.createSpan>;
    end: (update: { output?: unknown; metadata?: Record<string, unknown> }) => void;
  } {
    const span = this.createSpan(traceId, params);

    return {
      span,
      end: (update) => {
        if (span) {
          try {
            span.end(update);
          } catch (error) {
            this.logger.error('Failed to end span', error);
          }
        }
      },
    };
  }

  /**
   * Helper: Estimate token count for text (rough estimation)
   * For accurate counts, use tiktoken or model-specific tokenizers
   */
  estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token for English
    return Math.ceil(text.length / 4);
  }
}
