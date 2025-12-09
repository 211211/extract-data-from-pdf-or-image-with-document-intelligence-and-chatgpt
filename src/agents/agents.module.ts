import { HandoffOrchestrator, MultiAgentOrchestrator } from './orchestrator/multi-agent.orchestrator';
import { Module, OnModuleInit } from '@nestjs/common';

import { AgentFactory } from './agent.factory';
import { ConfigModule } from '@nestjs/config';
import { NormalAgent } from './normal/normal.agent';
import { ParallelSearchAgent } from './orchestrator/parallel-search.agent';
import { PlannerAgent } from './orchestrator/planner.agent';
import { RAGAgent } from './rag/rag.agent';
import { ResearcherAgent } from './orchestrator/researcher.agent';
import { ResultRankerAgent } from './orchestrator/result-ranker.agent';
import { WriterAgent } from './orchestrator/writer.agent';

/**
 * Agents Module
 *
 * Central module for all agent types.
 * Handles agent registration with the factory.
 *
 * Available agents:
 * - normal: Basic conversational agent
 * - rag: Retrieval-Augmented Generation with vector search
 * - planner: Query analysis, decomposition into sub-queries
 * - parallel-search: Executes multiple searches concurrently
 * - result-ranker: Compares and ranks search results
 * - researcher: Information gathering (legacy)
 * - writer: Response generation
 * - multi-agent: Orchestrated multi-agent flow
 *
 * Multi-Agent Flow (Complex Queries):
 * Planner → ParallelSearch → ResultRanker → Writer
 *
 * Legacy Flow (Simple Queries):
 * Planner → Researcher → Writer
 */
@Module({
  imports: [ConfigModule],
  providers: [
    AgentFactory,
    // Individual agents
    NormalAgent,
    RAGAgent,
    PlannerAgent,
    ParallelSearchAgent,
    ResultRankerAgent,
    ResearcherAgent,
    WriterAgent,
    // Orchestrators
    MultiAgentOrchestrator,
    HandoffOrchestrator,
  ],
  exports: [
    AgentFactory,
    NormalAgent,
    RAGAgent,
    PlannerAgent,
    ParallelSearchAgent,
    ResultRankerAgent,
    ResearcherAgent,
    WriterAgent,
    MultiAgentOrchestrator,
    HandoffOrchestrator,
  ],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    private agentFactory: AgentFactory,
    private normalAgent: NormalAgent,
    private ragAgent: RAGAgent,
    private plannerAgent: PlannerAgent,
    private parallelSearchAgent: ParallelSearchAgent,
    private resultRankerAgent: ResultRankerAgent,
    private researcherAgent: ResearcherAgent,
    private writerAgent: WriterAgent,
    private multiAgentOrchestrator: MultiAgentOrchestrator,
  ) {}

  onModuleInit() {
    // Register all agents with the factory
    this.agentFactory.registerInstance('normal', this.normalAgent);
    this.agentFactory.registerInstance('rag', this.ragAgent);
    this.agentFactory.registerInstance('planner', this.plannerAgent);
    this.agentFactory.registerInstance('parallel-search', this.parallelSearchAgent);
    this.agentFactory.registerInstance('result-ranker', this.resultRankerAgent);
    this.agentFactory.registerInstance('researcher', this.researcherAgent);
    this.agentFactory.registerInstance('writer', this.writerAgent);
    this.agentFactory.registerInstance('multi-agent', this.multiAgentOrchestrator);

    console.log('Registered agents:', this.agentFactory.getAvailableTypes().join(', '));
  }
}
