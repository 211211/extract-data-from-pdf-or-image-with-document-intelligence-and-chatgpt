import { AgentConfig, BaseAgent } from '../agent.interface';
import { AgentContext, SSEEvent } from '../../core/streaming/types';
import { LangfuseService } from '../../core/observability/langfuse.service';
import { getOpenAIClient, OpenAIResponsesClient } from '../openai-responses.client';

import { Injectable, Optional } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

interface Message {
  role: string;
  content: string;
}

/**
 * Normal Chat Agent
 *
 * Basic conversational agent using Azure OpenAI via OpenAI SDK.
 * Streams responses token by token via SSE.
 *
 * Features:
 * - Full message history support for multi-turn conversations
 * - Configurable temperature and max tokens
 * - Proper SSE event sequencing
 * - Uses Azure AI Foundry endpoint with OpenAI SDK
 */
@Injectable()
export class NormalAgent extends BaseAgent {
  readonly name = 'NormalAgent';
  readonly description = 'General-purpose conversational AI agent';

  private client: OpenAIResponsesClient;

  constructor(@Optional() private langfuseService?: LangfuseService) {
    super();
    this.client = getOpenAIClient();
  }

  async *run(context: AgentContext, config?: AgentConfig): AsyncGenerator<SSEEvent> {
    const traceId = context.traceId || uuidv7();
    let fullOutput = '';
    let inputTokens = 0;
    let outputTokens = 0;

    // Create Langfuse trace for this conversation
    const trace = this.langfuseService?.createTrace(traceId, 'chat', {
      userId: context.userId,
      sessionId: context.sessionId,
      metadata: {
        agent: this.name,
        ...context.metadata,
      },
      tags: ['normal-agent', 'chat'],
      input: context.messageHistory,
    });

    // 1. Emit metadata event (required first event)
    yield this.createMetadataEvent({
      trace_id: traceId,
      citations: [],
    });

    // 2. Emit agent_updated to indicate we're starting
    yield this.createAgentUpdatedEvent({
      answer: this.name,
      content_type: 'final_answer',
    });

    // Start Langfuse generation tracking
    const generationTracker = this.langfuseService?.startGeneration(traceId, {
      name: 'chat-completion',
      model: this.client.getModel(),
      modelParameters: {
        temperature: config?.temperature ?? 0.7,
        maxTokens: config?.maxTokens || 4096,
      },
      input: context.messageHistory,
      metadata: { agent: this.name },
    });

    try {
      // Check if client is configured
      if (!this.client.isConfigured()) {
        throw new Error(
          'Azure OpenAI client not configured. Please set AZURE_OPENAI_API_BASE_URL and AZURE_OPENAI_API_KEY',
        );
      }

      // 3. Prepare messages for Chat Completions API
      const messages = this.prepareMessages(context, config?.systemPrompt);

      // Estimate input tokens
      inputTokens = this.langfuseService?.estimateTokens(messages.map((m) => String(m.content)).join(' ')) || 0;

      // 4. Stream from Azure OpenAI using shared client
      for await (const chunk of this.client.stream({
        messages,
        maxTokens: config?.maxTokens || 4096,
        temperature: config?.temperature ?? 0.7,
      })) {
        if (chunk.type === 'content' && chunk.content) {
          fullOutput += chunk.content;
          yield this.createDataEvent(chunk.content);
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error);
        }
      }

      // Estimate output tokens
      outputTokens = this.langfuseService?.estimateTokens(fullOutput) || 0;

      // End Langfuse generation with success
      generationTracker?.end({
        output: fullOutput,
        usage: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
          unit: 'TOKENS',
        },
        level: 'DEFAULT',
      });

      // Update trace with output
      this.langfuseService?.updateTrace(traceId, {
        output: fullOutput,
        metadata: {
          tokenUsage: { input: inputTokens, output: outputTokens },
        },
      });

      // 5. Emit done event
      yield this.createDoneEvent({
        stream_id: traceId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      // End Langfuse generation with error
      generationTracker?.end({
        output: fullOutput || null,
        level: 'ERROR',
        statusMessage: errorMessage,
      });

      // Update trace with error
      this.langfuseService?.updateTrace(traceId, {
        output: { error: errorMessage },
        metadata: { error: true },
      });

      // Emit error event
      yield this.createErrorEvent(errorMessage, 'AGENT_ERROR');
    }
  }

  private prepareMessages(context: AgentContext, systemPrompt?: string): Message[] {
    const messages: Message[] = [];

    // Add system prompt as first message
    const systemContent =
      systemPrompt ||
      `You are a helpful AI assistant. Provide clear, accurate, and helpful responses.
Be concise but thorough. If you don't know something, say so.
Current date: ${new Date().toISOString().split('T')[0]}`;

    messages.push({
      role: 'system',
      content: systemContent,
    });

    // Add conversation history
    for (const msg of context.messageHistory) {
      if (msg.role === 'system') {
        // Skip system messages from history (we use our own)
        continue;
      }
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    return messages;
  }
}
