import { Injectable, OnModuleInit } from '@nestjs/common';

import { IAgent } from './agent.interface';
import { ModuleRef } from '@nestjs/core';

/**
 * Supported agent types
 */
export type AgentType = 'normal' | 'rag' | 'multi-agent' | 'planner' | 'researcher' | 'writer';

/**
 * Agent Factory
 *
 * Central registry for all agents. Allows:
 * - Dynamic agent registration
 * - Type-safe agent retrieval
 * - Lazy loading of agents
 *
 * Stateless: Each getAgent() call returns a fresh agent instance
 * suitable for horizontal scaling.
 */
@Injectable()
export class AgentFactory implements OnModuleInit {
  private agents: Map<AgentType, new (...args: any[]) => IAgent> = new Map();
  private instances: Map<AgentType, IAgent> = new Map();

  constructor(private moduleRef: ModuleRef) {}

  async onModuleInit() {
    // Agents will be registered by their respective modules
  }

  /**
   * Register an agent class with the factory
   *
   * @param type - Agent type identifier
   * @param agentClass - Agent class constructor
   */
  register(type: AgentType, agentClass: new (...args: any[]) => IAgent): void {
    this.agents.set(type, agentClass);
  }

  /**
   * Register an agent instance directly
   *
   * @param type - Agent type identifier
   * @param agent - Agent instance
   */
  registerInstance(type: AgentType, agent: IAgent): void {
    this.instances.set(type, agent);
  }

  /**
   * Get an agent by type
   *
   * @param type - Agent type to retrieve
   * @returns Agent instance
   * @throws Error if agent type is not registered
   */
  getAgent(type: AgentType): IAgent {
    // First check for registered instances
    const instance = this.instances.get(type);
    if (instance) {
      return instance;
    }

    // Then check for registered classes
    const AgentClass = this.agents.get(type);
    if (!AgentClass) {
      throw new Error(`Unknown agent type: ${type}. Available types: ${this.getAvailableTypes().join(', ')}`);
    }

    // Create instance via NestJS DI
    try {
      return this.moduleRef.get(AgentClass, { strict: false });
    } catch {
      // Fallback to direct instantiation if not in DI container
      return new AgentClass();
    }
  }

  /**
   * Check if an agent type is registered
   */
  hasAgent(type: AgentType): boolean {
    return this.agents.has(type) || this.instances.has(type);
  }

  /**
   * Get all available agent types
   */
  getAvailableTypes(): AgentType[] {
    const classTypes = Array.from(this.agents.keys());
    const instanceTypes = Array.from(this.instances.keys());
    return [...new Set([...classTypes, ...instanceTypes])];
  }

  /**
   * Get agent metadata for documentation/introspection
   */
  getAgentInfo(type: AgentType): { name: string; description?: string } | null {
    try {
      const agent = this.getAgent(type);
      return {
        name: agent.name,
        description: agent.description,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get all agents info
   */
  getAllAgentsInfo(): Array<{ type: AgentType; name: string; description?: string }> {
    return this.getAvailableTypes()
      .map((type) => {
        const info = this.getAgentInfo(type);
        return info ? { type, ...info } : null;
      })
      .filter(Boolean) as Array<{ type: AgentType; name: string; description?: string }>;
  }
}
