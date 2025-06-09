import {
  AzureCogDocumentIndex,
  clearIndex,
  getAllDocuments as cogGetAllDocuments,
  indexDocuments as cogIndexDocuments,
  semanticSearch as cogSemanticSearch,
  simpleSearch as cogSimpleSearch,
  vectorSearch as cogVectorSearch,
  resetIndex,
} from '../pdf-extractor/services/azure-cog-vector-store';

import { Injectable } from '@nestjs/common';

@Injectable()
export class SearchService {
  /**
   * Perform a semantic search.
   */
  async semanticSearch(query: string, top = 10, filter?: string): Promise<AzureCogDocumentIndex[]> {
    return cogSemanticSearch(query, top, filter);
  }

  /**
   * Perform a vector search.
   */
  async vectorSearch(query: string, k = 10, filter?: string): Promise<AzureCogDocumentIndex[]> {
    return cogVectorSearch(query, k, filter);
  }
  /**
   * Perform a simple term/keyword search.
   */
  async simpleSearch(query?: string, filter?: string): Promise<AzureCogDocumentIndex[]> {
    return cogSimpleSearch(query, filter);
  }

  /**
   * Perform a hybrid search (combine vector and semantic results).
   */
  async hybridSearch(query: string, top = 10, filter?: string): Promise<AzureCogDocumentIndex[]> {
    const [vectorResults, semanticResults] = await Promise.all([
      cogVectorSearch(query, top, filter),
      cogSemanticSearch(query, top, filter),
    ]);
    const scoreMap = new Map<string, { doc: AzureCogDocumentIndex; score: number }>();
    const addResults = (docs: AzureCogDocumentIndex[], weight: number) => {
      docs.forEach((doc, idx) => {
        const prev = scoreMap.get(doc.id);
        const sc = weight * (docs.length - idx);
        if (prev) {
          prev.score += sc;
        } else {
          scoreMap.set(doc.id, { doc, score: sc });
        }
      });
    };
    addResults(vectorResults, 1);
    addResults(semanticResults, 1);
    const merged = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, top)
      .map((v) => v.doc);
    return merged;
  }
  /**
   * Index arbitrary documents into the search service.
   */
  async index(documents: AzureCogDocumentIndex[]): Promise<void> {
    await cogIndexDocuments(documents);
  }

  /**
   * Seed the search index with sample documents.
   */
  async seed(): Promise<void> {
    const samples: AzureCogDocumentIndex[] = [
      {
        id: '1',
        pageContent:
          'NestJS is a progressive Node.js framework for building efficient and scalable server-side applications.',
        user: 'alice',
        chatThreadId: 'thread-1',
        metadata: 'nestjs',
      },
      {
        id: '2',
        pageContent:
          'Express is a minimal and flexible Node.js web application framework that provides a robust set of features.',
        user: 'bob',
        chatThreadId: 'thread-2',
        metadata: 'express',
      },
      {
        id: '3',
        pageContent:
          'Java Spring Boot simplifies the creation of stand-alone, production-grade Spring-based applications.',
        user: 'carol',
        chatThreadId: 'thread-3',
        metadata: 'spring',
      },
      {
        id: '4',
        pageContent: 'React is an open-source JavaScript library for building user interfaces on the client side.',
        user: 'dave',
        chatThreadId: 'thread-4',
        metadata: 'react',
      },
      {
        id: '5',
        pageContent: 'Embeddings convert text into numerical vectors to enable similarity search.',
        user: 'eve',
        chatThreadId: 'thread-5',
        metadata: 'embeddings',
      },
      {
        id: '6',
        pageContent: 'Semantic ranking uses AI to understand query intent and context for improved relevance.',
        user: 'alice',
        chatThreadId: 'thread-1',
        metadata: 'semantic',
      },
      {
        id: '7',
        pageContent: 'Azure Cognitive Search provides full-text search with filters, sorting, and faceted navigation.',
        user: 'bob',
        chatThreadId: 'thread-2',
        metadata: 'azure-search',
      },
      {
        id: '8',
        pageContent: 'Vector search finds the nearest neighbor documents based on their embeddings distance.',
        user: 'carol',
        chatThreadId: 'thread-3',
        metadata: 'vector-search',
      },
    ];
    await cogIndexDocuments(samples);
  }

  /**
   * Reset the search index: delete and recreate.
   */
  async reset(): Promise<void> {
    await resetIndex();
  }

  /**
   * Clear all documents from the specified search index, leaving the index structure intact.
   * @param indexName Optional name of the index; defaults to env AZURE_SEARCH_INDEX_NAME
   */
  async clear(indexName?: string): Promise<void> {
    const idx = indexName || process.env.AZURE_SEARCH_INDEX_NAME;
    if (!idx) {
      throw new Error('Index name must be provided either as argument or AZURE_SEARCH_INDEX_NAME env variable');
    }
    await clearIndex(idx);
  }

  /**
   * Retrieve all documents from the specified Azure Search index.
   * @param indexName Optional name of the index; defaults to env AZURE_SEARCH_INDEX_NAME
   * @returns Promise resolving to an array of all documents in the index
   */
  async getAllDocuments(indexName?: string): Promise<AzureCogDocumentIndex[]> {
    const idx = indexName || process.env.AZURE_SEARCH_INDEX_NAME;
    if (!idx) {
      throw new Error('Index name must be provided either as argument or AZURE_SEARCH_INDEX_NAME env variable');
    }
    return cogGetAllDocuments(idx);
  }
}
