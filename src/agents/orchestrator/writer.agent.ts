import { AgentConfig, BaseAgent } from '../agent.interface';
import { AgentContext, SSEEvent } from '../../core/streaming/types';
import { getOpenAIClient, OpenAIResponsesClient } from '../openai-responses.client';

import { ExecutionPlan } from './planner.agent';
import { Injectable } from '@nestjs/common';
import { ResearchFindings } from './researcher.agent';

interface Message {
  role: string;
  content: string;
}

/**
 * Writer Agent
 *
 * Generates the final response based on:
 * - Original query
 * - Execution plan
 * - Research findings (if any)
 *
 * Streams the response token by token.
 * Uses Azure AI Foundry endpoint with OpenAI SDK
 */
@Injectable()
export class WriterAgent extends BaseAgent {
  readonly name = 'WriterAgent';
  readonly description = 'Generates final responses';

  private client: OpenAIResponsesClient;
  private _plan: ExecutionPlan | null = null;
  private _findings: ResearchFindings | null = null;

  constructor() {
    super();
    this.client = getOpenAIClient();
  }

  /**
   * Set context from previous agents
   */
  setContext(plan: ExecutionPlan | null, findings: ResearchFindings | null): void {
    this._plan = plan;
    this._findings = findings;
  }

  async *run(context: AgentContext, config?: AgentConfig): AsyncGenerator<SSEEvent> {
    // 1. Emit agent_updated to show we're writing
    yield this.createAgentUpdatedEvent({
      answer: this.name,
      content_type: 'final_answer',
      job_description: 'Generating response...',
    });

    try {
      // Check if client is configured
      if (!this.client.isConfigured()) {
        throw new Error(
          'Azure OpenAI client not configured. Please set AZURE_OPENAI_API_BASE_URL and AZURE_OPENAI_API_KEY',
        );
      }

      // 2. Build context-aware prompt
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(context);

      // 3. Build messages for Responses API
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...this.getConversationHistory(context),
        { role: 'user', content: userPrompt },
      ];

      // 4. Stream from Azure OpenAI using shared client
      for await (const chunk of this.client.stream({
        messages,
        maxTokens: config?.maxTokens || 4096,
        temperature: config?.temperature ?? 0.7,
      })) {
        if (chunk.type === 'content' && chunk.content) {
          yield this.createDataEvent(chunk.content);
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error);
        }
      }
    } catch (error) {
      yield this.createErrorEvent(error instanceof Error ? error.message : 'Writing failed', 'AGENT_ERROR');
    }
  }

  private buildSystemPrompt(): string {
    let prompt = `You are a helpful AI assistant that provides clear, accurate, and well-structured responses.

Guidelines:
- Be thorough but concise
- Use markdown formatting when appropriate
- Cite sources if available
- Admit uncertainty when applicable`;

    if (this._plan) {
      prompt += `\n\nExecution Plan: ${this._plan.summary}`;
    }

    if (this._findings) {
      // Handle extended findings from parallel search
      if (this._findings.summary) {
        prompt += `\n\nContext:\n${this._findings.summary}`;
      }

      // Handle document context
      if (this._findings.documents && this._findings.documents.length > 0) {
        prompt += `\n\nRelevant Documents:\n`;
        for (const doc of this._findings.documents.slice(0, 5)) {
          prompt += `\n**${doc.title}**\n${doc.content.substring(0, 500)}...\n`;
        }
      }

      // Handle legacy findings format
      if (this._findings.findings && this._findings.findings.length > 0) {
        prompt += `\n\nResearch Findings:\n${this._findings.findings.map((f) => `- ${f}`).join('\n')}`;
      }

      // Handle citations
      if (this._findings.citations && this._findings.citations.length > 0) {
        prompt += `\n\nAvailable Citations (use when relevant):\n`;
        for (const citation of this._findings.citations.slice(0, 5)) {
          prompt += `- ${citation.title}${citation.source ? ` (${citation.source})` : ''}\n`;
        }
      }
    }

    return prompt;
  }

  private buildUserPrompt(context: AgentContext): string {
    const lastUserMessage = context.messageHistory.filter((m) => m.role === 'user').pop();

    return lastUserMessage?.content || 'Please provide a response.';
  }

  private getConversationHistory(context: AgentContext): Message[] {
    // Get last N messages for context (excluding the last user message which we handle separately)
    const messages = context.messageHistory.slice(0, -1);
    const lastN = messages.slice(-10); // Keep last 10 messages for context

    return lastN
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));
  }
}
