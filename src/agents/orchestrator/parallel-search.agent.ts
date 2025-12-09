import { AgentContext, Citation, SSEEvent } from '../../core/streaming/types';
import { BaseAgent, IHandoffAgent } from '../agent.interface';
import { AzureKeyCredential, SearchClient, SearchOptions } from '@azure/search-documents';

import { Injectable } from '@nestjs/common';
import { ExecutionPlan, SubQuery } from './planner.agent';

/**
 * Search result for a single sub-query
 */
export interface SubQueryResult {
  subQueryId: string;
  query: string;
  documents: SearchDocument[];
  relevanceScore: number;
  searchTimeMs: number;
  error?: string;
}

/**
 * Aggregated search results from all sub-queries
 */
export interface ParallelSearchResults {
  results: SubQueryResult[];
  bestMatch: SubQueryResult | null;
  totalDocuments: number;
  citations: Citation[];
  searchSummary: string;
}

interface SearchDocument {
  id: string;
  content: string;
  title?: string;
  source?: string;
  chunk_id?: string;
  '@search.score'?: number;
  '@search.rerankerScore'?: number;
}

/**
 * Parallel Search Agent
 *
 * Executes multiple sub-queries in parallel and aggregates results.
 * Key responsibilities:
 * 1. Execute all sub-queries concurrently
 * 2. Collect and deduplicate results
 * 3. Rank results by relevance
 * 4. Identify best matches
 *
 * Flow:
 * Planner → ParallelSearchAgent → ResultRanker → Writer
 */
@Injectable()
export class ParallelSearchAgent extends BaseAgent implements IHandoffAgent {
  readonly name = 'ParallelSearchAgent';
  readonly description = 'Executes multiple search queries in parallel';

  private searchClient: SearchClient<SearchDocument> | null = null;
  private _shouldHandoff = true;
  private _handoffTarget: string | null = 'ResultRankerAgent';
  private _handoffReason: string | null = 'Search complete, ready for ranking';
  private _results: ParallelSearchResults | null = null;
  private _plan: ExecutionPlan | null = null;

  constructor() {
    super();
    this.initializeSearchClient();
  }

  private initializeSearchClient(): void {
    const searchName = process.env.AZURE_SEARCH_NAME;
    const searchKey = process.env.AZURE_SEARCH_API_KEY;
    const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

    if (searchName && searchKey && indexName) {
      this.searchClient = new SearchClient<SearchDocument>(
        `https://${searchName}.search.windows.net`,
        indexName,
        new AzureKeyCredential(searchKey),
      );
    }
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

  getResults(): ParallelSearchResults | null {
    return this._results;
  }

  setContext(plan: ExecutionPlan): void {
    this._plan = plan;
  }

  async *run(context: AgentContext): AsyncGenerator<SSEEvent> {
    // Reset state
    this._results = null;
    this._shouldHandoff = false;

    // 1. Emit agent_updated
    yield this.createAgentUpdatedEvent({
      answer: this.name,
      content_type: 'thoughts',
      job_description: 'Executing parallel searches...',
    });

    try {
      if (!this._plan) {
        throw new Error('No execution plan provided. Call setContext() first.');
      }

      const subQueries = this._plan.subQueries;

      if (!this.searchClient) {
        yield this.createDataEvent('⚠️ Search not configured. Using mock results.\n\n');
        this._results = this.getMockResults(subQueries);
      } else {
        yield this.createDataEvent(`🔍 Executing ${subQueries.length} searches in parallel...\n\n`);

        // 2. Execute all searches in parallel using allSettled (resilient to failures)
        const startTime = Date.now();
        const searchPromises = subQueries.map((sq) => this.executeSearch(sq));
        const settledResults = await Promise.allSettled(searchPromises);

        // Convert settled results to SubQueryResult array
        const results: SubQueryResult[] = settledResults.map((settled, index) => {
          if (settled.status === 'fulfilled') {
            return settled.value;
          }
          // Handle rejected promise - create error result
          return {
            subQueryId: subQueries[index].id,
            query: subQueries[index].query,
            documents: [],
            relevanceScore: 0,
            searchTimeMs: Date.now() - startTime,
            error: settled.reason instanceof Error ? settled.reason.message : 'Search failed',
          };
        });

        const totalTime = Date.now() - startTime;

        // 3. Process and emit results for each sub-query
        for (const result of results) {
          const status = result.error ? '❌' : '✅';
          yield this.createDataEvent(
            `${status} ${result.subQueryId}: Found ${result.documents.length} docs ` +
              `(${result.searchTimeMs}ms, relevance: ${(result.relevanceScore * 100).toFixed(1)}%)\n`,
          );
        }

        yield this.createDataEvent(`\n⏱️ Total parallel search time: ${totalTime}ms\n`);

        // 4. Aggregate results
        this._results = this.aggregateResults(results, subQueries);

        yield this.createDataEvent(`📊 Total unique documents: ${this._results.totalDocuments}\n`);

        if (this._results.bestMatch) {
          yield this.createDataEvent(
            `🏆 Best match: ${this._results.bestMatch.subQueryId} ` +
              `(${(this._results.bestMatch.relevanceScore * 100).toFixed(1)}% relevance)\n`,
          );
        }
      }

      yield this.createDataEvent(`\n${this._results.searchSummary}\n\n`);

      // 5. Set handoff
      this._shouldHandoff = true;
      this._handoffTarget = 'ResultRankerAgent';
      this._handoffReason = `Found ${this._results.totalDocuments} documents across ${subQueries.length} queries`;
    } catch (error) {
      yield this.createErrorEvent(error instanceof Error ? error.message : 'Parallel search failed', 'AGENT_ERROR');
      this._shouldHandoff = false;
    }
  }

  private async executeSearch(subQuery: SubQuery): Promise<SubQueryResult> {
    const startTime = Date.now();

    try {
      if (!this.searchClient) {
        throw new Error('Search client not initialized');
      }

      // Determine search options based on strategy
      const searchOptions = this.getSearchOptions(subQuery);

      const results = await this.searchClient.search(subQuery.query, searchOptions);

      const documents: SearchDocument[] = [];
      let totalScore = 0;

      for await (const result of results.results) {
        documents.push(result.document);
        totalScore += result.score || 0;
      }

      const avgScore = documents.length > 0 ? totalScore / documents.length : 0;

      return {
        subQueryId: subQuery.id,
        query: subQuery.query,
        documents,
        relevanceScore: Math.min(avgScore / 10, 1), // Normalize to 0-1
        searchTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        subQueryId: subQuery.id,
        query: subQuery.query,
        documents: [],
        relevanceScore: 0,
        searchTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  }

  private getSearchOptions(subQuery: SubQuery): SearchOptions<SearchDocument> {
    const baseOptions: SearchOptions<SearchDocument> = {
      top: 5,
      select: ['id', 'content', 'title', 'source', 'chunk_id'],
    };

    switch (subQuery.searchStrategy) {
      case 'semantic':
        return {
          ...baseOptions,
          queryType: 'semantic',
          semanticSearchOptions: {
            configurationName: 'default',
          },
        };

      case 'keyword':
        return {
          ...baseOptions,
          queryType: 'simple',
        };

      case 'hybrid':
      default:
        return {
          ...baseOptions,
          queryType: 'semantic',
          semanticSearchOptions: {
            configurationName: 'default',
          },
        };
    }
  }

  private aggregateResults(results: SubQueryResult[], subQueries: SubQuery[]): ParallelSearchResults {
    // Deduplicate documents by ID
    const documentMap = new Map<string, SearchDocument>();
    const citations: Citation[] = [];

    for (const result of results) {
      for (const doc of result.documents) {
        if (!documentMap.has(doc.id)) {
          documentMap.set(doc.id, doc);
          citations.push({
            title: doc.title || doc.id,
            source: doc.source,
            snippet: doc.content.substring(0, 200) + '...',
          });
        }
      }
    }

    // Find best match (highest relevance with results)
    const successfulResults = results.filter((r) => !r.error && r.documents.length > 0);
    const bestMatch =
      successfulResults.length > 0
        ? successfulResults.reduce((best, current) => (current.relevanceScore > best.relevanceScore ? current : best))
        : null;

    // Generate summary
    const successCount = successfulResults.length;
    const totalQueries = subQueries.length;
    const searchSummary =
      `Searched ${totalQueries} queries: ${successCount} successful, ` +
      `${totalQueries - successCount} failed. ` +
      `Found ${documentMap.size} unique documents.`;

    return {
      results,
      bestMatch,
      totalDocuments: documentMap.size,
      citations,
      searchSummary,
    };
  }

  private getMockResults(subQueries: SubQuery[]): ParallelSearchResults {
    const results: SubQueryResult[] = subQueries.map((sq, index) => ({
      subQueryId: sq.id,
      query: sq.query,
      documents: [
        {
          id: `mock-doc-${index}-1`,
          content: `Mock content for query: ${sq.query}. This is simulated search result.`,
          title: `Mock Document ${index + 1}`,
          source: 'mock-source',
        },
      ],
      relevanceScore: 0.7 + Math.random() * 0.2,
      searchTimeMs: 50 + Math.floor(Math.random() * 100),
    }));

    const citations = results.flatMap((r) =>
      r.documents.map((doc) => ({
        title: doc.title || doc.id,
        source: doc.source,
        snippet: doc.content.substring(0, 100) + '...',
      })),
    );

    return {
      results,
      bestMatch: results[0],
      totalDocuments: results.length,
      citations,
      searchSummary: `Mock search: ${subQueries.length} queries executed with simulated results.`,
    };
  }
}
