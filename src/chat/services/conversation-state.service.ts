import { Injectable } from '@nestjs/common';

/**
 * Conversation State
 *
 * Tracks state across turns in a conversation.
 * For simplicity, uses in-memory storage.
 * In production with horizontal scaling, use Redis.
 */
export interface ConversationState {
  threadId: string;
  userId: string;
  currentTurn: number;
  createdAt: Date;
  updatedAt: Date;
  context: Record<string, unknown>;
  previousQueries: string[];
  previousResults: TurnResult[];
  metadata: Record<string, unknown>;
}

export interface TurnResult {
  turn: number;
  query: string;
  result: string;
  success: boolean;
  agentUsed: string;
  timestamp: Date;
}

/**
 * Conversation State Service
 *
 * Manages conversation state for multi-turn interactions.
 * Currently uses in-memory storage for simplicity.
 *
 * Features:
 * - Turn tracking
 * - Query/result history
 * - Context accumulation
 * - State persistence (in-memory)
 *
 * For horizontal scaling, extend to use Redis.
 */
@Injectable()
export class ConversationStateService {
  private states = new Map<string, ConversationState>();
  private readonly STATE_TTL = 86400000; // 24 hours in ms

  constructor() {}

  /**
   * Initialize a new conversation state
   */
  async initState(threadId: string, userId: string): Promise<ConversationState> {
    const now = new Date();
    const state: ConversationState = {
      threadId,
      userId,
      currentTurn: 0,
      createdAt: now,
      updatedAt: now,
      context: {},
      previousQueries: [],
      previousResults: [],
      metadata: {},
    };

    this.states.set(threadId, state);
    return state;
  }

  /**
   * Get conversation state
   */
  async getState(threadId: string): Promise<ConversationState | null> {
    return this.states.get(threadId) || null;
  }

  /**
   * Update conversation state
   */
  async updateState(threadId: string, updates: Partial<ConversationState>): Promise<ConversationState | null> {
    const state = this.states.get(threadId);
    if (!state) return null;

    const updated: ConversationState = {
      ...state,
      ...updates,
      updatedAt: new Date(),
    };

    this.states.set(threadId, updated);
    return updated;
  }

  /**
   * Record a turn result
   */
  async recordTurn(
    threadId: string,
    query: string,
    result: string,
    success: boolean,
    agentUsed: string,
  ): Promise<void> {
    const state = this.states.get(threadId);
    if (!state) return;

    const turnResult: TurnResult = {
      turn: state.currentTurn + 1,
      query,
      result: result.substring(0, 500), // Truncate to save space
      success,
      agentUsed,
      timestamp: new Date(),
    };

    await this.updateState(threadId, {
      currentTurn: state.currentTurn + 1,
      previousQueries: [...state.previousQueries.slice(-9), query],
      previousResults: [...state.previousResults.slice(-9), turnResult],
    });
  }

  /**
   * Add context to the conversation
   */
  async addContext(threadId: string, key: string, value: unknown): Promise<void> {
    const state = this.states.get(threadId);
    if (!state) return;

    await this.updateState(threadId, {
      context: {
        ...state.context,
        [key]: value,
      },
    });
  }

  /**
   * Get accumulated context
   */
  async getContext(threadId: string): Promise<Record<string, unknown>> {
    const state = this.states.get(threadId);
    return state?.context || {};
  }

  /**
   * Get recent turn results for debugging/analytics
   */
  async getRecentTurns(threadId: string, limit: number = 5): Promise<TurnResult[]> {
    const state = this.states.get(threadId);
    if (!state) return [];
    return state.previousResults.slice(-limit);
  }

  /**
   * Clear conversation state
   */
  async clearState(threadId: string): Promise<void> {
    this.states.delete(threadId);
  }

  /**
   * Get active state count (for monitoring)
   */
  getStateCount(): number {
    return this.states.size;
  }
}
