import { AgentConfig, BaseAgent, IHandoffAgent } from '../agent.interface';
import { AgentContext, SSEEvent } from '../../core/streaming/types';

import { Injectable } from '@nestjs/common';
import { ParallelSearchAgent } from './parallel-search.agent';
import { PlannerAgent } from './planner.agent';
import { ResearcherAgent } from './researcher.agent';
import { ResultRankerAgent } from './result-ranker.agent';
import { WriterAgent } from './writer.agent';
import { v7 as uuidv7 } from 'uuid';

/**
 * Multi-Agent Orchestrator
 *
 * Coordinates multiple agents to handle complex queries with improved flow:
 *
 * NEW FLOW (Query Decomposition + Parallel Search):
 * 1. PlannerAgent - Decomposes query into sub-queries
 * 2. ParallelSearchAgent - Executes all sub-queries in parallel
 * 3. ResultRankerAgent - Compares results, selects best matches
 * 4. WriterAgent - Generates final response
 *
 * LEGACY FLOW (Single Query):
 * 1. PlannerAgent - Analyzes query
 * 2. ResearcherAgent - Gathers information (if needed)
 * 3. WriterAgent - Generates response
 *
 * Implements the handoff pattern where each agent decides
 * whether to hand off to another agent.
 *
 * Event flow:
 * - metadata (once at start)
 * - agent_updated (for each agent)
 * - data (streaming content)
 * - done (once at end)
 */
@Injectable()
export class MultiAgentOrchestrator extends BaseAgent {
  readonly name = 'MultiAgentOrchestrator';
  readonly description = 'Coordinates multiple agents for complex queries with parallel search';

  private maxIterations = 6; // Increased for new flow

  constructor(
    private readonly plannerAgent: PlannerAgent,
    private readonly parallelSearchAgent: ParallelSearchAgent,
    private readonly resultRankerAgent: ResultRankerAgent,
    private readonly researcherAgent: ResearcherAgent,
    private readonly writerAgent: WriterAgent,
  ) {
    super();
  }

  async *run(context: AgentContext, config?: AgentConfig): AsyncGenerator<SSEEvent> {
    const traceId = context.traceId || uuidv7();

    // 1. Emit metadata event (required first event)
    yield this.createMetadataEvent({
      trace_id: traceId,
      citations: [],
    });

    try {
      // 2. Run Planner Agent - Decomposes query into sub-queries
      yield this.createDataEvent('🎯 **Phase 1: Query Analysis & Decomposition**\n\n');

      for await (const event of this.plannerAgent.run(context)) {
        if (event.event !== 'metadata' && event.event !== 'done') {
          yield event;
        }
      }

      const plan = this.plannerAgent.getPlan();

      if (!plan) {
        yield this.createErrorEvent('Planning failed - no execution plan', 'AGENT_ERROR');
        return;
      }

      // 3. Determine flow based on plan
      const useParallelSearch =
        this.plannerAgent.shouldHandoff() &&
        this.plannerAgent.getHandoffTarget() === 'ParallelSearchAgent' &&
        plan.subQueries.length > 1 &&
        plan.parallelExecution;

      if (useParallelSearch) {
        // NEW FLOW: Parallel Search + Ranking
        yield* this.runParallelSearchFlow(context, plan, config);
      } else if (plan.requiresResearch || plan.requiresRag) {
        // LEGACY FLOW: Single query research
        yield* this.runResearchFlow(context, plan, config);
      } else {
        // SIMPLE FLOW: Direct to writer
        yield* this.runSimpleFlow(context, plan, config);
      }

      // 5. Emit done event
      yield this.createDoneEvent({
        stream_id: traceId,
      });
    } catch (error) {
      yield this.createErrorEvent(error instanceof Error ? error.message : 'Orchestration failed', 'AGENT_ERROR');
    }
  }

  /**
   * New flow: Parallel Search → Result Ranking → Writer
   */
  private async *runParallelSearchFlow(
    context: AgentContext,
    plan: NonNullable<ReturnType<PlannerAgent['getPlan']>>,
    config?: AgentConfig,
  ): AsyncGenerator<SSEEvent> {
    // Phase 2: Parallel Search
    yield this.createDataEvent('\n🔍 **Phase 2: Parallel Search Execution**\n\n');

    this.parallelSearchAgent.setContext(plan);

    for await (const event of this.parallelSearchAgent.run(context)) {
      if (event.event !== 'metadata' && event.event !== 'done') {
        yield event;
      }
    }

    const searchResults = this.parallelSearchAgent.getResults();

    if (!searchResults || searchResults.totalDocuments === 0) {
      yield this.createDataEvent('\n⚠️ No search results found. Generating response without context...\n\n');
      yield* this.runSimpleFlow(context, plan, config);
      return;
    }

    // Phase 3: Result Ranking
    yield this.createDataEvent('\n📊 **Phase 3: Result Analysis & Ranking**\n\n');

    this.resultRankerAgent.setContext(searchResults, plan.originalQuery);

    for await (const event of this.resultRankerAgent.run(context)) {
      if (event.event !== 'metadata' && event.event !== 'done') {
        yield event;
      }
    }

    const rankingOutput = this.resultRankerAgent.getRankingOutput();

    // Phase 4: Response Generation
    yield this.createDataEvent('\n✍️ **Phase 4: Response Generation**\n\n');

    this.writerAgent.setContext(plan, {
      summary: rankingOutput?.synthesizedContext || searchResults.searchSummary,
      documents: searchResults.results.flatMap((r) =>
        r.documents.map((d) => ({
          id: d.id,
          title: d.title || d.id,
          content: d.content,
          source: d.source,
          score: d['@search.score'],
        })),
      ),
      citations: rankingOutput?.citations || searchResults.citations,
    });

    for await (const event of this.writerAgent.run(context, config)) {
      if (event.event !== 'metadata' && event.event !== 'done') {
        yield event;
      }
    }
  }

  /**
   * Legacy flow: Research → Writer
   */
  private async *runResearchFlow(
    context: AgentContext,
    plan: NonNullable<ReturnType<PlannerAgent['getPlan']>>,
    config?: AgentConfig,
  ): AsyncGenerator<SSEEvent> {
    yield this.createDataEvent('\n🔬 **Phase 2: Research**\n\n');

    this.researcherAgent.setContext(plan);

    for await (const event of this.researcherAgent.run(context)) {
      if (event.event !== 'metadata' && event.event !== 'done') {
        yield event;
      }
    }

    yield this.createDataEvent('\n✍️ **Phase 3: Response Generation**\n\n');

    const findings = this.researcherAgent.getFindings();
    this.writerAgent.setContext(plan, findings);

    for await (const event of this.writerAgent.run(context, config)) {
      if (event.event !== 'metadata' && event.event !== 'done') {
        yield event;
      }
    }
  }

  /**
   * Simple flow: Direct to Writer
   */
  private async *runSimpleFlow(
    context: AgentContext,
    plan: NonNullable<ReturnType<PlannerAgent['getPlan']>>,
    config?: AgentConfig,
  ): AsyncGenerator<SSEEvent> {
    yield this.createDataEvent('\n✍️ **Generating Response**\n\n');

    this.writerAgent.setContext(plan, null);

    for await (const event of this.writerAgent.run(context, config)) {
      if (event.event !== 'metadata' && event.event !== 'done') {
        yield event;
      }
    }
  }
}

/**
 * Generic Handoff Orchestrator
 *
 * More flexible orchestrator that uses the handoff pattern
 * to dynamically route between agents.
 */
@Injectable()
export class HandoffOrchestrator extends BaseAgent {
  readonly name = 'HandoffOrchestrator';
  readonly description = 'Dynamic agent routing via handoff pattern';

  private agents: Map<string, BaseAgent> = new Map();
  private maxIterations = 10;

  /**
   * Register an agent with the orchestrator
   */
  registerAgent(name: string, agent: BaseAgent): void {
    this.agents.set(name, agent);
  }

  /**
   * Set the starting agent
   */
  private startingAgent: string = 'PlannerAgent';

  setStartingAgent(name: string): void {
    this.startingAgent = name;
  }

  /**
   * Get a registered agent by name
   */
  getAgent<T extends BaseAgent>(name: string): T | undefined {
    return this.agents.get(name) as T | undefined;
  }

  async *run(context: AgentContext, config?: AgentConfig): AsyncGenerator<SSEEvent> {
    const traceId = context.traceId || uuidv7();

    // 1. Emit metadata
    yield this.createMetadataEvent({
      trace_id: traceId,
      citations: [],
    });

    let currentAgentName: string | null = this.startingAgent;
    let iteration = 0;
    let previousOutput: unknown = null;

    try {
      while (currentAgentName && iteration < this.maxIterations) {
        const agent = this.agents.get(currentAgentName);
        if (!agent) {
          yield this.createErrorEvent(`Agent not found: ${currentAgentName}`, 'AGENT_ERROR');
          break;
        }

        // Pass context from previous agent if available
        if (previousOutput && 'setContext' in agent) {
          (agent as any).setContext(previousOutput);
        }

        // Run the current agent
        for await (const event of agent.run(context, config)) {
          if (event.event !== 'metadata' && event.event !== 'done') {
            yield event;
          }
        }

        // Capture output for next agent
        if ('getResults' in agent) {
          previousOutput = (agent as any).getResults();
        } else if ('getPlan' in agent) {
          previousOutput = (agent as any).getPlan();
        } else if ('getRankingOutput' in agent) {
          previousOutput = (agent as any).getRankingOutput();
        } else if ('getFindings' in agent) {
          previousOutput = (agent as any).getFindings();
        }

        // Check for handoff
        if (this.isHandoffAgent(agent) && agent.shouldHandoff()) {
          currentAgentName = agent.getHandoffTarget();
          iteration++;
        } else {
          currentAgentName = null;
        }
      }

      if (iteration >= this.maxIterations) {
        yield this.createDataEvent('\n⚠️ Max iterations reached. Stopping orchestration.\n');
      }

      // 2. Emit done
      yield this.createDoneEvent({
        stream_id: traceId,
      });
    } catch (error) {
      yield this.createErrorEvent(
        error instanceof Error ? error.message : 'Handoff orchestration failed',
        'AGENT_ERROR',
      );
    }
  }

  private isHandoffAgent(agent: BaseAgent): agent is BaseAgent & IHandoffAgent {
    return 'shouldHandoff' in agent && 'getHandoffTarget' in agent;
  }
}
