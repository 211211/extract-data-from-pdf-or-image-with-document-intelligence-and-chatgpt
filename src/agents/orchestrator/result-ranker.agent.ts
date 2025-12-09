import { AgentContext, Citation, SSEEvent } from '../../core/streaming/types';
import { BaseAgent, IHandoffAgent } from '../agent.interface';
import { getOpenAIClient, OpenAIResponsesClient } from '../openai-responses.client';
import { ParallelSearchResults, SubQueryResult } from './parallel-search.agent';

import { Injectable } from '@nestjs/common';

interface Message {
  role: string;
  content: string;
}

/**
 * Ranked result with explanation
 */
export interface RankedResult {
  subQueryId: string;
  query: string;
  rank: number;
  relevanceScore: number;
  documentCount: number;
  reasoning: string;
  isSelected: boolean;
}

/**
 * Final ranking output
 */
export interface RankingOutput {
  rankedResults: RankedResult[];
  selectedResults: RankedResult[];
  synthesizedContext: string;
  citations: Citation[];
  confidence: number;
  rankingStrategy: string;
}

/**
 * Result Ranker Agent
 *
 * Compares and ranks search results from parallel queries.
 * Key responsibilities:
 * 1. Analyze relevance of each sub-query result
 * 2. Rank results by quality and relevance
 * 3. Select best matches for final answer
 * 4. Synthesize context from selected results
 *
 * Flow:
 * ParallelSearchAgent → ResultRankerAgent → WriterAgent
 */
@Injectable()
export class ResultRankerAgent extends BaseAgent implements IHandoffAgent {
  readonly name = 'ResultRankerAgent';
  readonly description = 'Compares and ranks search results, selects best matches';

  private client: OpenAIResponsesClient;
  private _shouldHandoff = false;
  private _handoffTarget: string | null = 'WriterAgent';
  private _handoffReason: string | null = 'Results ranked, ready for response generation';
  private _rankingOutput: RankingOutput | null = null;
  private _searchResults: ParallelSearchResults | null = null;
  private _originalQuery: string | null = null;

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

  getRankingOutput(): RankingOutput | null {
    return this._rankingOutput;
  }

  setContext(searchResults: ParallelSearchResults, originalQuery: string): void {
    this._searchResults = searchResults;
    this._originalQuery = originalQuery;
  }

  async *run(context: AgentContext): AsyncGenerator<SSEEvent> {
    // Reset state
    this._rankingOutput = null;
    this._shouldHandoff = false;

    // 1. Emit agent_updated
    yield this.createAgentUpdatedEvent({
      answer: this.name,
      content_type: 'thoughts',
      job_description: 'Analyzing and ranking search results...',
    });

    try {
      if (!this._searchResults) {
        throw new Error('No search results provided. Call setContext() first.');
      }

      const results = this._searchResults.results;

      yield this.createDataEvent(`\n📊 Ranking ${results.length} search results...\n\n`);

      // 2. Perform ranking
      let rankedResults: RankedResult[];

      if (this.client.isConfigured() && results.length > 1) {
        // Use LLM for intelligent ranking
        yield this.createDataEvent('🤖 Using AI to analyze result relevance...\n');
        rankedResults = await this.rankWithLLM(results);
      } else {
        // Use heuristic ranking
        yield this.createDataEvent('📐 Using heuristic ranking...\n');
        rankedResults = this.rankWithHeuristics(results);
      }

      // 3. Select top results
      const selectedResults = this.selectBestResults(rankedResults);

      // 4. Emit ranking results
      yield this.createDataEvent('\n🏆 **Ranking Results:**\n');
      for (const result of rankedResults) {
        const marker = result.isSelected ? '✅' : '  ';
        yield this.createDataEvent(
          `${marker} #${result.rank}: ${result.subQueryId} (${(result.relevanceScore * 100).toFixed(1)}%) - ${
            result.reasoning
          }\n`,
        );
      }

      // 5. Synthesize context from selected results
      const synthesizedContext = this.synthesizeContext(selectedResults, results);

      yield this.createDataEvent(`\n📝 Synthesized context from ${selectedResults.length} best results\n`);

      // 6. Build output
      this._rankingOutput = {
        rankedResults,
        selectedResults,
        synthesizedContext,
        citations: this._searchResults.citations,
        confidence: this.calculateConfidence(selectedResults),
        rankingStrategy: this.client.isConfigured() ? 'llm-assisted' : 'heuristic',
      };

      yield this.createDataEvent(
        `\n✨ Confidence: ${(this._rankingOutput.confidence * 100).toFixed(1)}%\n` +
          `📚 Citations: ${this._rankingOutput.citations.length}\n\n`,
      );

      // 7. Set handoff
      this._shouldHandoff = true;
      this._handoffTarget = 'WriterAgent';
      this._handoffReason = `Selected ${selectedResults.length} results with ${(
        this._rankingOutput.confidence * 100
      ).toFixed(0)}% confidence`;
    } catch (error) {
      yield this.createErrorEvent(error instanceof Error ? error.message : 'Ranking failed', 'AGENT_ERROR');
      this._shouldHandoff = false;
    }
  }

  private async rankWithLLM(results: SubQueryResult[]): Promise<RankedResult[]> {
    const resultsJson = results.map((r) => ({
      id: r.subQueryId,
      query: r.query,
      documentCount: r.documents.length,
      avgScore: r.relevanceScore,
      sampleContent: r.documents.slice(0, 2).map((d) => d.content.substring(0, 200)),
      hasError: !!r.error,
    }));

    const messages: Message[] = [
      { role: 'system', content: this.getRankingPrompt() },
      {
        role: 'user',
        content: `Original Query: "${this._originalQuery}"\n\nSearch Results:\n${JSON.stringify(
          resultsJson,
          null,
          2,
        )}\n\nRank these results by relevance to the original query. Output as JSON array.`,
      },
    ];

    try {
      const response = await this.client.complete({
        messages,
        temperature: 0.3,
        maxTokens: 1024,
        jsonMode: true,
        timeout: 20000, // 20 second timeout for ranking (should be fast)
      });

      const parsed = JSON.parse(response);
      const rankings = Array.isArray(parsed) ? parsed : parsed.rankings || [];

      return results
        .map((r, index) => {
          const llmRank = rankings.find((rank: any) => rank.id === r.subQueryId);
          return {
            subQueryId: r.subQueryId,
            query: r.query,
            rank: llmRank?.rank || index + 1,
            relevanceScore: llmRank?.relevance || r.relevanceScore,
            documentCount: r.documents.length,
            reasoning: llmRank?.reasoning || 'Ranked by search score',
            isSelected: false,
          };
        })
        .sort((a, b) => a.rank - b.rank);
    } catch (error) {
      // Fallback to heuristics if LLM fails (including timeout)
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[ResultRankerAgent] LLM ranking failed, falling back to heuristics: ${errorMsg}`);
      return this.rankWithHeuristics(results);
    }
  }

  private rankWithHeuristics(results: SubQueryResult[]): RankedResult[] {
    // Multi-factor scoring:
    // - Relevance score (from search) - 50%
    // - Document count (more = better coverage) - 30%
    // - No errors - 20%

    const scored = results.map((r) => {
      const relevanceWeight = r.relevanceScore * 0.5;
      const coverageWeight = Math.min(r.documents.length / 5, 1) * 0.3;
      const errorWeight = r.error ? 0 : 0.2;
      const totalScore = relevanceWeight + coverageWeight + errorWeight;

      return {
        result: r,
        score: totalScore,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.map((s, index) => ({
      subQueryId: s.result.subQueryId,
      query: s.result.query,
      rank: index + 1,
      relevanceScore: s.score,
      documentCount: s.result.documents.length,
      reasoning: this.generateHeuristicReasoning(s.result, s.score),
      isSelected: false,
    }));
  }

  private generateHeuristicReasoning(result: SubQueryResult, score: number): string {
    const parts: string[] = [];

    if (result.error) {
      parts.push('search failed');
    } else {
      if (result.relevanceScore > 0.7) {
        parts.push('high relevance');
      } else if (result.relevanceScore > 0.4) {
        parts.push('moderate relevance');
      } else {
        parts.push('low relevance');
      }

      if (result.documents.length >= 5) {
        parts.push('good coverage');
      } else if (result.documents.length >= 2) {
        parts.push('some results');
      } else if (result.documents.length === 1) {
        parts.push('limited results');
      } else {
        parts.push('no results');
      }
    }

    return parts.join(', ');
  }

  private selectBestResults(rankedResults: RankedResult[]): RankedResult[] {
    // Selection strategy:
    // 1. Always include #1 if it has documents
    // 2. Include #2-3 if they have high enough scores
    // 3. Cap at 3 selected results

    const selected: RankedResult[] = [];
    const minScore = 0.3;
    const maxSelected = 3;

    for (const result of rankedResults) {
      if (selected.length >= maxSelected) break;

      // Must have documents and meet minimum score
      if (result.documentCount > 0 && result.relevanceScore >= minScore) {
        result.isSelected = true;
        selected.push(result);
      }
    }

    // If nothing selected, force select the best one with documents
    if (selected.length === 0) {
      const bestWithDocs = rankedResults.find((r) => r.documentCount > 0);
      if (bestWithDocs) {
        bestWithDocs.isSelected = true;
        selected.push(bestWithDocs);
      }
    }

    return selected;
  }

  private synthesizeContext(selectedResults: RankedResult[], allResults: SubQueryResult[]): string {
    const contextParts: string[] = [];

    for (const selected of selectedResults) {
      const fullResult = allResults.find((r) => r.subQueryId === selected.subQueryId);
      if (!fullResult) continue;

      contextParts.push(`\n### ${selected.subQueryId}: ${selected.query}\n`);

      for (const doc of fullResult.documents) {
        const title = doc.title || doc.id;
        const content = doc.content.substring(0, 500);
        contextParts.push(`**${title}**\n${content}\n`);
      }
    }

    return contextParts.join('\n');
  }

  private calculateConfidence(selectedResults: RankedResult[]): number {
    if (selectedResults.length === 0) return 0;

    // Average relevance score of selected results
    const avgRelevance = selectedResults.reduce((sum, r) => sum + r.relevanceScore, 0) / selectedResults.length;

    // Bonus for multiple sources
    const sourceBonus = Math.min(selectedResults.length * 0.1, 0.2);

    return Math.min(avgRelevance + sourceBonus, 1);
  }

  private getRankingPrompt(): string {
    return `You are a search result ranking expert. Given search results from multiple sub-queries, rank them by:
1. Relevance to the original query
2. Quality and completeness of content
3. Coverage of the topic
4. Reliability (no errors)

Output JSON array:
[
  {
    "id": "Q1",
    "rank": 1,
    "relevance": 0.85,
    "reasoning": "Brief explanation"
  }
]

Rules:
- Rank 1 is best
- Relevance is 0-1 scale
- Consider how well each sub-query's results answer the original question
- Penalize results with errors or no documents`;
  }
}
