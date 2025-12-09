import { AgentConfig, BaseAgent } from '../agent.interface';
import { AgentContext, SSEEvent } from '../../core/streaming/types';

import { Injectable } from '@nestjs/common';
import { PlannerAgent } from './planner.agent';
import { ResearcherAgent } from './researcher.agent';
import { WriterAgent } from './writer.agent';
import { v7 as uuidv7 } from 'uuid';

/**
 * Multi-Agent Orchestrator
 *
 * Coordinates multiple agents to handle complex queries:
 * 1. PlannerAgent - Analyzes query and creates execution plan
 * 2. ResearcherAgent - Gathers information (if needed)
 * 3. WriterAgent - Generates final response
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
  readonly description = 'Coordinates multiple agents for complex queries';

  private maxIterations = 5; // Prevent infinite loops

  constructor(
    private readonly plannerAgent: PlannerAgent,
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
      // 2. Run Planner Agent
      for await (const event of this.plannerAgent.run(context)) {
        // Don't yield metadata/done from sub-agents
        if (event.event !== 'metadata' && event.event !== 'done') {
          yield event;
        }
      }

      const plan = this.plannerAgent.getPlan();

      // 3. Check if research is needed
      if (
        this.plannerAgent.shouldHandoff() &&
        (this.plannerAgent.getHandoffTarget() === 'ResearcherAgent' || plan?.requiresResearch || plan?.requiresRag)
      ) {
        // Run Researcher Agent
        this.researcherAgent.setContext(plan!);

        for await (const event of this.researcherAgent.run(context)) {
          if (event.event !== 'metadata' && event.event !== 'done') {
            yield event;
          }
        }
      }

      // 4. Run Writer Agent (always runs last)
      const findings = this.researcherAgent.getFindings();
      this.writerAgent.setContext(plan, findings);

      for await (const event of this.writerAgent.run(context, config)) {
        if (event.event !== 'metadata' && event.event !== 'done') {
          yield event;
        }
      }

      // 5. Emit done event
      yield this.createDoneEvent({
        stream_id: traceId,
      });
    } catch (error) {
      yield this.createErrorEvent(error instanceof Error ? error.message : 'Orchestration failed', 'AGENT_ERROR');
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

  async *run(context: AgentContext, config?: AgentConfig): AsyncGenerator<SSEEvent> {
    const traceId = context.traceId || uuidv7();

    // 1. Emit metadata
    yield this.createMetadataEvent({
      trace_id: traceId,
      citations: [],
    });

    let currentAgentName: string | null = this.startingAgent;
    let iteration = 0;

    try {
      while (currentAgentName && iteration < this.maxIterations) {
        const agent = this.agents.get(currentAgentName);
        if (!agent) {
          yield this.createErrorEvent(`Agent not found: ${currentAgentName}`, 'AGENT_ERROR');
          break;
        }

        // Run the current agent
        for await (const event of agent.run(context, config)) {
          if (event.event !== 'metadata' && event.event !== 'done') {
            yield event;
          }
        }

        // Check for handoff
        if ('shouldHandoff' in agent && (agent as any).shouldHandoff()) {
          currentAgentName = (agent as any).getHandoffTarget();
          iteration++;
        } else {
          currentAgentName = null;
        }
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
}
