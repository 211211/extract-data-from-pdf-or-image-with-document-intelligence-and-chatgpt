import { AgentConfig, BaseAgent } from '../agent.interface';
import { AgentContext, Citation, SSEEvent } from '../../core/streaming/types';
import { AzureKeyCredential, SearchClient, SearchOptions } from '@azure/search-documents';
import { LangfuseService } from '../../core/observability/langfuse.service';
import { getOpenAIClient, OpenAIResponsesClient } from '../openai-responses.client';

import { Injectable, Optional } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

interface Message {
  role: string;
  content: string;
}

/**
 * Search result document interface
 */
interface SearchDocument {
  id: string;
  content: string;
  title?: string;
  source?: string;
  chunk_id?: string;
  metadata?: Record<string, unknown>;
  '@search.score'?: number;
  '@search.rerankerScore'?: number;
}

/**
 * RAG Agent
 *
 * Retrieval-Augmented Generation agent that:
 * 1. Searches Azure Cognitive Search for relevant documents
 * 2. Builds context from retrieved documents
 * 3. Generates response using LLM with retrieved context
 *
 * Supports:
 * - Semantic search
 * - Hybrid search (semantic + keyword)
 * - Vector search (if embeddings configured)
 * - Uses Azure AI Foundry endpoint with OpenAI SDK
 */
@Injectable()
export class RAGAgent extends BaseAgent {
  readonly name = 'RAGAgent';
  readonly description = 'Retrieval-Augmented Generation with vector search';

  private client: OpenAIResponsesClient;
  private searchClient: SearchClient<SearchDocument> | null = null;

  constructor(@Optional() private langfuseService?: LangfuseService) {
    super();
    this.client = getOpenAIClient();
    this.initializeSearchClient();
  }

  private initializeSearchClient(): void {
    // Initialize Azure Search client
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

  async *run(context: AgentContext, config?: AgentConfig): AsyncGenerator<SSEEvent> {
    const traceId = context.traceId || uuidv7();
    const citations: Citation[] = [];
    let fullOutput = '';
    let inputTokens = 0;
    let outputTokens = 0;

    // Create Langfuse trace for RAG workflow
    const trace = this.langfuseService?.createTrace(traceId, 'rag', {
      userId: context.userId,
      sessionId: context.sessionId,
      metadata: {
        agent: this.name,
        ...context.metadata,
      },
      tags: ['rag-agent', 'retrieval', 'chat'],
      input: context.messageHistory,
    });

    // 1. Emit metadata
    yield this.createMetadataEvent({
      trace_id: traceId,
      citations: [],
    });

    // 2. Emit agent_updated for search phase
    yield this.createAgentUpdatedEvent({
      answer: this.name,
      content_type: 'thoughts',
      job_description: 'Searching knowledge base...',
    });

    try {
      // Check if client is configured
      if (!this.client.isConfigured()) {
        throw new Error(
          'Azure OpenAI client not configured. Please set AZURE_OPENAI_API_BASE_URL and AZURE_OPENAI_API_KEY',
        );
      }

      // 3. Get the user query
      const lastUserMessage = context.messageHistory.filter((m) => m.role === 'user').pop();

      if (!lastUserMessage) {
        yield this.createErrorEvent('No user message found', 'AGENT_ERROR');
        return;
      }

      const query = lastUserMessage.content;

      // 4. Search for relevant documents
      let searchResults: SearchDocument[] = [];

      if (this.searchClient) {
        yield this.createDataEvent('Searching documents...\n');

        // Track search operation in Langfuse
        const searchTracker = this.langfuseService?.startSpan(traceId, {
          name: 'document-search',
          input: { query, searchType: 'semantic' },
          metadata: { indexName: process.env.AZURE_SEARCH_INDEX_NAME },
        });

        searchResults = await this.searchDocuments(query);

        searchTracker?.end({
          output: {
            resultCount: searchResults.length,
            documents: searchResults.map((d) => ({ id: d.id, title: d.title })),
          },
        });

        if (searchResults.length > 0) {
          yield this.createDataEvent(`Found ${searchResults.length} relevant documents.\n\n`);

          // Build citations
          for (const doc of searchResults) {
            citations.push({
              title: doc.title || doc.id,
              source: doc.source,
              snippet: doc.content.substring(0, 200) + '...',
            });
          }
        } else {
          yield this.createDataEvent('No relevant documents found.\n\n');
        }
      } else {
        yield this.createDataEvent('Search not configured. Proceeding without document retrieval.\n\n');
      }

      // 5. Switch to final answer phase
      yield this.createAgentUpdatedEvent({
        answer: this.name,
        content_type: 'final_answer',
        job_description: 'Generating response...',
      });

      // Update citations in metadata
      yield this.createMetadataEvent({
        trace_id: traceId,
        citations,
      });

      // 6. Build context and generate response
      const contextText = this.buildContext(searchResults);
      const systemPrompt = this.buildSystemPrompt(contextText);

      // Build messages for Responses API
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...this.getConversationHistory(context),
        { role: 'user', content: query },
      ];

      // Estimate input tokens
      inputTokens = this.langfuseService?.estimateTokens(messages.map((m) => String(m.content)).join(' ')) || 0;

      // Start Langfuse generation tracking for LLM call
      const generationTracker = this.langfuseService?.startGeneration(traceId, {
        name: 'rag-completion',
        model: this.client.getModel(),
        modelParameters: {
          temperature: config?.temperature ?? 0.7,
          maxTokens: config?.maxTokens || 4096,
        },
        input: {
          query,
          contextDocuments: searchResults.length,
          messages,
        },
        metadata: {
          agent: this.name,
          citations: citations.length,
        },
      });

      // 7. Stream from Azure OpenAI using shared client
      for await (const chunk of this.client.stream({
        messages,
        maxTokens: config?.maxTokens || 4096,
        temperature: config?.temperature ?? 0.7,
      })) {
        if (chunk.type === 'content' && chunk.content) {
          fullOutput += chunk.content;
          yield this.createDataEvent(chunk.content);
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error);
        }
      }

      // Estimate output tokens
      outputTokens = this.langfuseService?.estimateTokens(fullOutput) || 0;

      // End Langfuse generation with success
      generationTracker?.end({
        output: fullOutput,
        usage: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
          unit: 'TOKENS',
        },
        level: 'DEFAULT',
      });

      // Update trace with final output
      this.langfuseService?.updateTrace(traceId, {
        output: fullOutput,
        metadata: {
          tokenUsage: { input: inputTokens, output: outputTokens },
          citationsCount: citations.length,
          documentsRetrieved: searchResults.length,
        },
      });

      // 8. Done
      yield this.createDoneEvent({
        stream_id: traceId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'RAG failed';

      // Update trace with error
      this.langfuseService?.updateTrace(traceId, {
        output: { error: errorMessage },
        metadata: { error: true },
      });

      yield this.createErrorEvent(errorMessage, 'AGENT_ERROR');
    }
  }

  /**
   * Search documents using Azure Cognitive Search
   */
  private async searchDocuments(query: string): Promise<SearchDocument[]> {
    if (!this.searchClient) return [];

    try {
      const searchOptions: SearchOptions<SearchDocument> = {
        top: 5,
        queryType: 'semantic',
        semanticSearchOptions: {
          configurationName: 'default',
        },
        select: ['id', 'content', 'title', 'source', 'chunk_id'],
      };

      const results = await this.searchClient.search(query, searchOptions);

      const documents: SearchDocument[] = [];
      for await (const result of results.results) {
        documents.push(result.document);
      }

      return documents;
    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  }

  /**
   * Build context from search results
   */
  private buildContext(documents: SearchDocument[]): string {
    if (documents.length === 0) return '';

    const contextParts = documents.map((doc, index) => {
      return `[Document ${index + 1}]
Title: ${doc.title || 'Untitled'}
Source: ${doc.source || 'Unknown'}
Content:
${doc.content}
---`;
    });

    return contextParts.join('\n\n');
  }

  /**
   * Build system prompt with context
   */
  private buildSystemPrompt(context: string): string {
    if (!context) {
      return `You are a helpful AI assistant. Answer questions based on your knowledge.
If you don't know the answer, say so. Be concise but thorough.`;
    }

    return `You are a helpful AI assistant with access to a knowledge base.
Use the following documents to answer the user's question.
If the documents don't contain relevant information, say so and provide your best answer.
Always cite your sources when using information from the documents.

Knowledge Base:
${context}

Instructions:
- Answer based on the provided documents when possible
- Cite document numbers when referencing specific information
- Be concise but thorough
- If uncertain, acknowledge limitations`;
  }

  /**
   * Get conversation history for context
   */
  private getConversationHistory(context: AgentContext): Message[] {
    const messages = context.messageHistory.slice(0, -1);
    const lastN = messages.slice(-6);

    return lastN
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));
  }
}
