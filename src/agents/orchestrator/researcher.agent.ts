import { AgentContext, SSEEvent } from '../../core/streaming/types';
import { BaseAgent, IHandoffAgent } from '../agent.interface';
import { getOpenAIClient, OpenAIResponsesClient } from '../openai-responses.client';

import { ExecutionPlan } from './planner.agent';
import { Injectable } from '@nestjs/common';

interface Message {
  role: string;
  content: string;
}

/**
 * Document from search results
 */
export interface SearchDocument {
  id: string;
  title: string;
  content: string;
  source?: string;
  score?: number;
}

/**
 * Citation for response attribution
 */
export interface Citation {
  title: string;
  source?: string;
  snippet?: string;
}

/**
 * Research findings structure
 * Supports both legacy research flow and new parallel search flow
 */
export interface ResearchFindings {
  // Legacy fields (from ResearcherAgent)
  findings?: string[];
  sources?: string[];
  confidence?: number;

  // Extended fields (from ParallelSearchAgent + ResultRankerAgent)
  summary?: string;
  documents?: SearchDocument[];
  citations?: Citation[];
}

/**
 * Researcher Agent
 *
 * Gathers information based on the execution plan.
 * In a real implementation, this would:
 * - Query vector stores
 * - Search external sources
 * - Aggregate information
 *
 * Uses Azure AI Foundry endpoint with OpenAI SDK
 */
@Injectable()
export class ResearcherAgent extends BaseAgent implements IHandoffAgent {
  readonly name = 'ResearcherAgent';
  readonly description = 'Gathers and synthesizes information';

  private client: OpenAIResponsesClient;
  private _shouldHandoff = true;
  private _handoffTarget = 'WriterAgent';
  private _handoffReason = 'Research complete, ready for writing';
  private _findings: ResearchFindings | null = null;

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

  getFindings(): ResearchFindings | null {
    return this._findings;
  }

  setContext(plan: ExecutionPlan): void {
    // Store plan for research context
    (this as any)._plan = plan;
  }

  async *run(context: AgentContext): AsyncGenerator<SSEEvent> {
    // Reset state
    this._findings = null;

    // 1. Emit agent_updated to show we're researching
    yield this.createAgentUpdatedEvent({
      answer: this.name,
      content_type: 'thoughts',
      job_description: 'Gathering and synthesizing information...',
    });

    try {
      // Check if client is configured
      if (!this.client.isConfigured()) {
        throw new Error(
          'Azure OpenAI client not configured. Please set AZURE_OPENAI_API_BASE_URL and AZURE_OPENAI_API_KEY',
        );
      }

      const lastUserMessage = context.messageHistory.filter((m) => m.role === 'user').pop();

      if (!lastUserMessage) {
        yield this.createErrorEvent('No user message found', 'AGENT_ERROR');
        return;
      }

      // 2. Simulate research (in production, this would query vector stores, etc.)
      yield this.createDataEvent('Researching relevant information...\n');

      // Simulate async research steps
      const researchSteps = ['Analyzing query context...', 'Searching knowledge base...', 'Synthesizing findings...'];

      for (const step of researchSteps) {
        yield this.createDataEvent(`• ${step}\n`);
        await this.delay(100); // Small delay to simulate work
      }

      // 3. Generate research findings using Responses API with JSON mode
      const messages: Message[] = [
        { role: 'system', content: this.getSystemPrompt() },
        {
          role: 'user',
          content: `Research the following query and provide structured findings:\n\n${lastUserMessage.content}`,
        },
      ];

      const findingsJson = await this.client.complete({
        messages,
        temperature: 0.5,
        maxTokens: 2048,
        jsonMode: true,
        timeout: 30000, // 30 second timeout for research
      });

      this._findings = this.parseFindings(findingsJson);

      // 4. Emit findings summary
      yield this.createDataEvent(`\nResearch findings:\n${this._findings.findings.map((f) => `• ${f}`).join('\n')}\n`);

      // Always handoff to writer
      this._shouldHandoff = true;
      this._handoffTarget = 'WriterAgent';
      this._handoffReason = 'Research complete';
    } catch (error) {
      yield this.createErrorEvent(error instanceof Error ? error.message : 'Research failed', 'AGENT_ERROR');
      this._shouldHandoff = false;
    }
  }

  private getSystemPrompt(): string {
    return `You are a research assistant. Analyze queries and provide structured findings.

Output a JSON object with:
{
  "findings": ["finding1", "finding2", ...],
  "sources": ["source1", "source2", ...],
  "confidence": 0.0-1.0
}

Be thorough but concise. Focus on key facts and insights.`;
  }

  private parseFindings(json: string): ResearchFindings {
    try {
      const parsed = JSON.parse(json);
      return {
        findings: parsed.findings || ['Information gathered'],
        sources: parsed.sources || [],
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      return {
        findings: ['Research completed'],
        sources: [],
        confidence: 0.5,
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
