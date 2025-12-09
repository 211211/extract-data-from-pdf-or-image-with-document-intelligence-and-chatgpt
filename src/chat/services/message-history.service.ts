import { Injectable } from '@nestjs/common';
import { ChatMessage } from '../../core/streaming/types';

/**
 * Message History Configuration
 */
export interface MessageHistoryConfig {
  /** Maximum number of messages to keep */
  maxMessages: number;
  /** Maximum estimated tokens to keep */
  maxTokens: number;
  /** Whether to preserve system messages */
  preserveSystemMessages: boolean;
  /** Truncation strategy */
  truncationStrategy: 'oldest' | 'summarize';
}

/**
 * Prepared message for LLM
 */
export interface PreparedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Message History Service
 *
 * Manages conversation history for multi-turn chat:
 * - Prepares messages for LLM consumption
 * - Handles token-based truncation
 * - Formats history for different contexts
 *
 * Stateless design: All state passed as parameters
 */
@Injectable()
export class MessageHistoryService {
  private defaultConfig: MessageHistoryConfig = {
    maxMessages: 30,
    maxTokens: 8000,
    preserveSystemMessages: true,
    truncationStrategy: 'oldest',
  };

  /**
   * Prepare message history for LLM consumption
   *
   * @param messages - Full message history
   * @param config - Optional configuration overrides
   * @returns Prepared messages ready for LLM
   */
  prepareForLLM(messages: ChatMessage[], config?: Partial<MessageHistoryConfig>): PreparedMessage[] {
    const cfg = { ...this.defaultConfig, ...config };

    // Separate system messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Truncate conversation if needed
    let truncated = this.truncateMessages(conversationMessages, cfg);

    // Estimate tokens and further truncate if needed
    truncated = this.truncateByTokens(truncated, cfg.maxTokens);

    // Combine: system messages first, then conversation
    const result = cfg.preserveSystemMessages ? [...systemMessages, ...truncated] : truncated;

    return result.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  /**
   * Format history as a single string for context injection
   *
   * Useful for agents that need conversation context as text
   */
  formatAsContext(messages: ChatMessage[], lastN: number = 10): string {
    const recent = messages.slice(-lastN);
    return recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  }

  /**
   * Format history as chat turns (user/assistant pairs)
   */
  formatAsTurns(messages: ChatMessage[]): Array<{ user: string; assistant: string }> {
    const turns: Array<{ user: string; assistant: string }> = [];
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    for (let i = 0; i < conversationMessages.length - 1; i += 2) {
      const userMsg = conversationMessages[i];
      const assistantMsg = conversationMessages[i + 1];

      if (userMsg?.role === 'user' && assistantMsg?.role === 'assistant') {
        turns.push({
          user: userMsg.content,
          assistant: assistantMsg.content,
        });
      }
    }

    return turns;
  }

  /**
   * Extract messages by role
   */
  filterByRole(messages: ChatMessage[], role: 'user' | 'assistant' | 'system'): ChatMessage[] {
    return messages.filter((m) => m.role === role);
  }

  /**
   * Get the most recent user message
   */
  getLastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
    return [...messages].reverse().find((m) => m.role === 'user');
  }

  /**
   * Get the most recent assistant message
   */
  getLastAssistantMessage(messages: ChatMessage[]): ChatMessage | undefined {
    return [...messages].reverse().find((m) => m.role === 'assistant');
  }

  /**
   * Count estimated tokens in messages
   */
  estimateTokens(messages: ChatMessage[]): number {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    // Rough estimation: ~4 characters per token
    return Math.ceil(totalChars / 4);
  }

  /**
   * Check if messages are within token limit
   */
  isWithinTokenLimit(messages: ChatMessage[], maxTokens: number): boolean {
    return this.estimateTokens(messages) <= maxTokens;
  }

  /**
   * Deduplicate messages by ID
   */
  deduplicate(messages: ChatMessage[]): ChatMessage[] {
    const seen = new Set<string>();
    return messages.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }

  /**
   * Merge server updates with local messages
   *
   * Handles the case where server returns persisted IDs
   * that need to be reconciled with local optimistic IDs
   */
  mergeWithServerUpdates(localMessages: ChatMessage[], serverMessage: ChatMessage, localId: string): ChatMessage[] {
    return localMessages.map((m) => (m.id === localId ? { ...m, ...serverMessage, id: serverMessage.id } : m));
  }

  private truncateMessages(messages: ChatMessage[], config: MessageHistoryConfig): ChatMessage[] {
    if (messages.length <= config.maxMessages) {
      return messages;
    }

    // Keep the most recent messages
    return messages.slice(-config.maxMessages);
  }

  private truncateByTokens(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
    let totalTokens = 0;
    const result: ChatMessage[] = [];

    // Process from newest to oldest
    for (let i = messages.length - 1; i >= 0; i--) {
      const tokens = this.estimateMessageTokens(messages[i]);
      if (totalTokens + tokens > maxTokens) break;
      totalTokens += tokens;
      result.unshift(messages[i]);
    }

    return result;
  }

  private estimateMessageTokens(message: ChatMessage): number {
    // Rough estimation: ~4 characters per token + overhead for role
    return Math.ceil(message.content.length / 4) + 4;
  }
}
