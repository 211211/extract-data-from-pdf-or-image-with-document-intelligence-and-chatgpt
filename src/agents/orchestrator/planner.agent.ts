import { AgentContext, SSEEvent } from '../../core/streaming/types';
import { BaseAgent, IHandoffAgent } from '../agent.interface';
import { getOpenAIClient, OpenAIResponsesClient } from '../openai-responses.client';

import { Injectable } from '@nestjs/common';

interface Message {
  role: string;
  content: string;
}

/**
 * Execution Plan structure
 */
export interface ExecutionPlan {
  summary: string;
  requiresResearch: boolean;
  requiresRag: boolean;
  steps: string[];
  reasoning: string;
}

/**
 * Planner Agent
 *
 * Analyzes user queries and creates execution plans.
 * Decides which agents should be involved in answering.
 * Uses Azure AI Foundry endpoint with OpenAI SDK
 *
 * Outputs:
 * - thoughts: Planning reasoning
 * - final_answer: The execution plan
 */
@Injectable()
export class PlannerAgent extends BaseAgent implements IHandoffAgent {
  readonly name = 'PlannerAgent';
  readonly description = 'Analyzes queries and creates execution plans';

  private client: OpenAIResponsesClient;
  private _shouldHandoff = false;
  private _handoffTarget: string | null = null;
  private _handoffReason: string | null = null;
  private _plan: ExecutionPlan | null = null;

  constructor() {
    super();
    this.client = getOpenAIClient();
  }

  shouldHandoff(): boolean {
    return this._shouldHandoff;
  }

  getHandoffTarget(): string | null {
    return this._handoffTarget;
  }

  getHandoffReason(): string | null {
    return this._handoffReason;
  }

  getPlan(): ExecutionPlan | null {
    return this._plan;
  }

  async *run(context: AgentContext): AsyncGenerator<SSEEvent> {
    // Reset handoff state
    this._shouldHandoff = false;
    this._handoffTarget = null;
    this._handoffReason = null;
    this._plan = null;

    // 1. Emit agent_updated to show we're planning
    yield this.createAgentUpdatedEvent({
      answer: this.name,
      content_type: 'thoughts',
      job_description: 'Analyzing query and creating execution plan...',
    });

    try {
      // Check if client is configured
      if (!this.client.isConfigured()) {
        throw new Error(
          'Azure OpenAI client not configured. Please set AZURE_OPENAI_API_BASE_URL and AZURE_OPENAI_API_KEY',
        );
      }

      // 2. Get the last user message
      const lastUserMessage = context.messageHistory.filter((m) => m.role === 'user').pop();

      if (!lastUserMessage) {
        yield this.createErrorEvent('No user message found', 'AGENT_ERROR');
        return;
      }

      // 3. Create plan using Responses API with JSON mode
      const messages: Message[] = [
        { role: 'system', content: this.getSystemPrompt() },
        {
          role: 'user',
          content: `Query: ${lastUserMessage.content}\n\nAnalyze this query and provide an execution plan as JSON.`,
        },
      ];

      const planJson = await this.client.complete({
        messages,
        temperature: 0.3,
        maxTokens: 1024,
        jsonMode: true,
      });

      this._plan = this.parsePlan(planJson);

      // 4. Emit the plan as thinking
      yield this.createDataEvent(
        `Plan: ${this._plan.summary}\n\nSteps:\n${this._plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n`,
      );

      // 5. Determine handoff based on plan
      if (this._plan.requiresRag) {
        this._shouldHandoff = true;
        this._handoffTarget = 'ResearcherAgent';
        this._handoffReason = 'Query requires document retrieval';
      } else if (this._plan.requiresResearch) {
        this._shouldHandoff = true;
        this._handoffTarget = 'ResearcherAgent';
        this._handoffReason = 'Query requires additional research';
      } else {
        this._shouldHandoff = true;
        this._handoffTarget = 'WriterAgent';
        this._handoffReason = 'Direct response can be generated';
      }
    } catch (error) {
      yield this.createErrorEvent(error instanceof Error ? error.message : 'Planning failed', 'AGENT_ERROR');
    }
  }

  private getSystemPrompt(): string {
    return `You are a query analyzer and planner. Analyze user queries and create execution plans.

Output a JSON object with:
{
  "summary": "Brief summary of what needs to be done",
  "requiresResearch": true/false (if external knowledge/documents needed),
  "requiresRag": true/false (if vector store search is needed),
  "steps": ["step1", "step2", ...],
  "reasoning": "Why this plan was chosen"
}

Consider:
- Simple factual questions → no research needed
- Document-related questions → requires RAG
- Complex questions → may require research
- Multi-step questions → break down into steps`;
  }

  private parsePlan(json: string): ExecutionPlan {
    try {
      const parsed = JSON.parse(json);
      return {
        summary: parsed.summary || 'Processing query',
        requiresResearch: parsed.requiresResearch || false,
        requiresRag: parsed.requiresRag || false,
        steps: parsed.steps || ['Process query', 'Generate response'],
        reasoning: parsed.reasoning || '',
      };
    } catch {
      return {
        summary: 'Processing query',
        requiresResearch: false,
        requiresRag: false,
        steps: ['Process query', 'Generate response'],
        reasoning: 'Default plan due to parsing error',
      };
    }
  }
}
