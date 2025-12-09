import {
  AgentContext,
  AgentUpdatedPayload,
  DataPayload,
  DonePayload,
  ErrorPayload,
  MetadataPayload,
  SSEEvent,
} from '../core/streaming/types';

/**
 * Base Agent Interface
 *
 * All agents must implement this interface to work with the streaming system.
 * Agents are async generators that yield SSE events.
 *
 * Event sequence:
 * 1. metadata (required, first event)
 * 2. agent_updated (optional, can repeat for multi-agent)
 * 3. data (streaming content, can repeat)
 * 4. done (required, last event)
 *
 * On error:
 * - error event can be emitted at any point
 */
export interface IAgent {
  /**
   * Unique identifier for this agent type
   */
  readonly name: string;

  /**
   * Human-readable description of what this agent does
   */
  readonly description?: string;

  /**
   * Execute the agent and stream SSE events
   *
   * @param context - Agent execution context including message history
   * @param config - Optional agent configuration
   * @yields SSE events (metadata, agent_updated, data, done, error)
   */
  run(context: AgentContext, config?: AgentConfig): AsyncGenerator<SSEEvent>;
}

/**
 * Agent with handoff capability
 *
 * Some agents can decide to hand off to another agent.
 * Used in orchestration patterns.
 */
export interface IHandoffAgent extends IAgent {
  /**
   * After run() completes, check if handoff is needed
   */
  shouldHandoff(): boolean;

  /**
   * Get the name of the agent to hand off to
   */
  getHandoffTarget(): string | null;

  /**
   * Get the reason for handoff (for logging/debugging)
   */
  getHandoffReason(): string | null;
}

/**
 * Agent execution result
 *
 * Used by orchestrators to track agent execution
 */
export interface AgentResult {
  agentName: string;
  content: string;
  contentType: 'thoughts' | 'final_answer';
  success: boolean;
  error?: string;
  handoffTo?: string;
  handoffReason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Agent configuration options
 */
export interface AgentConfig {
  /**
   * Maximum tokens for response
   */
  maxTokens?: number;

  /**
   * Temperature for generation (0-1)
   */
  temperature?: number;

  /**
   * System prompt override
   */
  systemPrompt?: string;

  /**
   * Enable streaming (default: true)
   */
  streaming?: boolean;

  /**
   * Timeout in milliseconds
   */
  timeoutMs?: number;

  /**
   * Additional model-specific options
   */
  modelOptions?: Record<string, unknown>;
}

/**
 * Base class for agents with common utilities
 */
export abstract class BaseAgent implements IAgent {
  abstract readonly name: string;
  abstract readonly description?: string;

  abstract run(context: AgentContext, config?: AgentConfig): AsyncGenerator<SSEEvent>;

  /**
   * Helper to create a metadata event
   */
  protected createMetadataEvent(payload: MetadataPayload): SSEEvent<MetadataPayload> {
    return { event: 'metadata', data: payload };
  }

  /**
   * Helper to create an agent_updated event
   */
  protected createAgentUpdatedEvent(payload: AgentUpdatedPayload): SSEEvent<AgentUpdatedPayload> {
    return { event: 'agent_updated', data: payload };
  }

  /**
   * Helper to create a data event
   */
  protected createDataEvent(content: string): SSEEvent<DataPayload> {
    return { event: 'data', data: { answer: content } };
  }

  /**
   * Helper to create a done event
   */
  protected createDoneEvent(payload?: Partial<DonePayload>): SSEEvent<DonePayload> {
    return {
      event: 'done',
      data: { answer: 'Stream completed', ...payload },
    };
  }

  /**
   * Helper to create an error event
   */
  protected createErrorEvent(error: string, code?: string): SSEEvent<ErrorPayload> {
    return {
      event: 'error',
      data: { error, code: code as any },
    };
  }
}
