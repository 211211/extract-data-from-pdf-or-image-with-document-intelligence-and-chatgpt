import { AgentContext, SSEEvent } from '../../core/streaming/types';
import { BaseAgent, IHandoffAgent } from '../agent.interface';
import { getOpenAIClient, OpenAIResponsesClient } from '../openai-responses.client';

import { Injectable } from '@nestjs/common';

interface Message {
  role: string;
  content: string;
}

/**
 * Sub-query for parallel execution
 */
export interface SubQuery {
  id: string;
  query: string;
  intent: 'factual' | 'comparative' | 'procedural' | 'exploratory';
  priority: number; // 1-5, higher = more important
  searchStrategy: 'semantic' | 'keyword' | 'hybrid';
}

/**
 * Execution Plan structure
 */
export interface ExecutionPlan {
  summary: string;
  originalQuery: string;
  queryType: 'simple' | 'complex' | 'multi-part';
  subQueries: SubQuery[];
  requiresResearch: boolean;
  requiresRag: boolean;
  parallelExecution: boolean;
  steps: string[];
  reasoning: string;
}

/**
 * Planner Agent
 *
 * Analyzes user queries and creates execution plans.
 * Key responsibilities:
 * 1. Decompose complex queries into sub-queries
 * 2. Determine search strategy for each sub-query
 * 3. Decide parallel vs sequential execution
 * 4. Route to appropriate downstream agents
 *
 * Query Decomposition Examples:
 * - "Compare React and Vue for large apps" →
 *   - Sub-query 1: "React advantages for large applications"
 *   - Sub-query 2: "Vue advantages for large applications"
 *   - Sub-query 3: "React vs Vue performance benchmarks"
 */
@Injectable()
export class PlannerAgent extends BaseAgent implements IHandoffAgent {
  readonly name = 'PlannerAgent';
  readonly description = 'Analyzes queries, decomposes into sub-queries, and creates execution plans';

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
      job_description: 'Analyzing query and decomposing into sub-queries...',
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

      const userQuery = lastUserMessage.content;

      // 3. Analyze and decompose query
      yield this.createDataEvent('📋 Analyzing query complexity...\n');

      const messages: Message[] = [
        { role: 'system', content: this.getSystemPrompt() },
        {
          role: 'user',
          content: `Query: "${userQuery}"\n\nAnalyze this query and create a detailed execution plan with sub-queries if needed. Output as JSON.`,
        },
      ];

      const planJson = await this.client.complete({
        messages,
        temperature: 0.3,
        maxTokens: 2048,
        jsonMode: true,
        timeout: 25000, // 25 second timeout for planning
      });

      this._plan = this.parsePlan(planJson, userQuery);

      // 4. Emit the decomposition results
      yield this.createDataEvent(`\n🎯 Query Type: ${this._plan.queryType}\n`);
      yield this.createDataEvent(`📝 Summary: ${this._plan.summary}\n\n`);

      if (this._plan.subQueries.length > 1) {
        yield this.createDataEvent(`🔀 Decomposed into ${this._plan.subQueries.length} sub-queries:\n`);
        for (const sq of this._plan.subQueries) {
          yield this.createDataEvent(`   ${sq.id}. [${sq.intent}] "${sq.query}" (${sq.searchStrategy} search)\n`);
        }
        yield this.createDataEvent(`\n⚡ Parallel execution: ${this._plan.parallelExecution ? 'Yes' : 'No'}\n`);
      } else {
        yield this.createDataEvent(`📌 Single query - no decomposition needed\n`);
      }

      yield this.createDataEvent(`\n🔍 Strategy: ${this._plan.reasoning}\n\n`);

      // 5. Determine handoff based on plan
      this.determineHandoff();
    } catch (error) {
      yield this.createErrorEvent(error instanceof Error ? error.message : 'Planning failed', 'AGENT_ERROR');
    }
  }

  private determineHandoff(): void {
    if (!this._plan) return;

    // Complex queries with multiple sub-queries need parallel search
    if (this._plan.subQueries.length > 1 && this._plan.parallelExecution) {
      this._shouldHandoff = true;
      this._handoffTarget = 'ParallelSearchAgent';
      this._handoffReason = `Query decomposed into ${this._plan.subQueries.length} sub-queries for parallel search`;
      return;
    }

    // RAG queries
    if (this._plan.requiresRag) {
      this._shouldHandoff = true;
      this._handoffTarget = 'RAGAgent';
      this._handoffReason = 'Query requires document retrieval';
      return;
    }

    // Research queries
    if (this._plan.requiresResearch) {
      this._shouldHandoff = true;
      this._handoffTarget = 'ResearcherAgent';
      this._handoffReason = 'Query requires additional research';
      return;
    }

    // Simple queries go directly to writer
    this._shouldHandoff = true;
    this._handoffTarget = 'WriterAgent';
    this._handoffReason = 'Simple query - direct response';
  }

  private getSystemPrompt(): string {
    return `You are an expert query analyzer and planner. Your job is to:
1. Analyze user queries for complexity
2. Decompose complex queries into simpler sub-queries
3. Determine the best search strategy for each sub-query
4. Decide if queries should be executed in parallel

Query Types:
- simple: Single, direct question (no decomposition needed)
- complex: Multi-faceted question requiring analysis from multiple angles
- multi-part: Explicitly contains multiple questions

Intent Types:
- factual: Seeking specific facts or data
- comparative: Comparing two or more things
- procedural: How to do something
- exploratory: Open-ended exploration

Search Strategies:
- semantic: Best for conceptual, meaning-based queries
- keyword: Best for specific terms, names, codes
- hybrid: Combination when unsure

Output JSON format:
{
  "summary": "Brief summary of what the user wants",
  "queryType": "simple|complex|multi-part",
  "subQueries": [
    {
      "id": "Q1",
      "query": "Reformulated sub-query",
      "intent": "factual|comparative|procedural|exploratory",
      "priority": 1-5,
      "searchStrategy": "semantic|keyword|hybrid"
    }
  ],
  "requiresResearch": true/false,
  "requiresRag": true/false,
  "parallelExecution": true/false,
  "steps": ["step1", "step2"],
  "reasoning": "Why this plan was chosen"
}

Rules:
- For simple queries: return single subQuery with original query
- For comparisons: create one subQuery per item being compared
- For multi-part: create one subQuery per distinct question
- Max 5 sub-queries
- Set parallelExecution=true when sub-queries are independent
- Set requiresRag=true if documents/knowledge base needed
- Higher priority (5) for main question, lower (1-3) for context`;
  }

  private parsePlan(json: string, originalQuery: string): ExecutionPlan {
    try {
      const parsed = JSON.parse(json);

      // Ensure subQueries have proper structure
      const subQueries: SubQuery[] = (parsed.subQueries || []).map((sq: any, index: number) => ({
        id: sq.id || `Q${index + 1}`,
        query: sq.query || originalQuery,
        intent: sq.intent || 'factual',
        priority: sq.priority || 3,
        searchStrategy: sq.searchStrategy || 'hybrid',
      }));

      // If no sub-queries, create one from original
      if (subQueries.length === 0) {
        subQueries.push({
          id: 'Q1',
          query: originalQuery,
          intent: 'factual',
          priority: 5,
          searchStrategy: 'hybrid',
        });
      }

      return {
        summary: parsed.summary || 'Processing query',
        originalQuery,
        queryType: parsed.queryType || 'simple',
        subQueries,
        requiresResearch: parsed.requiresResearch || false,
        requiresRag: parsed.requiresRag || subQueries.length > 0,
        parallelExecution: parsed.parallelExecution || subQueries.length > 1,
        steps: parsed.steps || ['Analyze', 'Search', 'Synthesize'],
        reasoning: parsed.reasoning || 'Standard query processing',
      };
    } catch {
      // Fallback plan
      return {
        summary: 'Processing query',
        originalQuery,
        queryType: 'simple',
        subQueries: [
          {
            id: 'Q1',
            query: originalQuery,
            intent: 'factual',
            priority: 5,
            searchStrategy: 'hybrid',
          },
        ],
        requiresResearch: false,
        requiresRag: true,
        parallelExecution: false,
        steps: ['Process query', 'Generate response'],
        reasoning: 'Default plan due to parsing error',
      };
    }
  }
}
