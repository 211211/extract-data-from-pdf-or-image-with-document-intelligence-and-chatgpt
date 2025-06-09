import { AzureKeyCredential, SearchClient, SearchIndexClient, SemanticSearchOptions } from '@azure/search-documents';

import { AzureOpenAIEmbeddingInstance } from '../providers';
import { isUnexpected } from '@azure-rest/ai-inference';

export const AzureAISearchCredentials = () => {
  const apiKey = process.env.AZURE_SEARCH_API_KEY;
  const searchName = process.env.AZURE_SEARCH_NAME;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

  if (!apiKey || !searchName || !indexName) {
    throw new Error('One or more Azure AI Search environment variables are not set');
  }

  const endpoint = `https://${searchName}.search.windows.net`;
  return {
    apiKey,
    endpoint,
    indexName,
  };
};

export const AzureAISearchInstance = <T extends object>() => {
  const { apiKey, endpoint, indexName } = AzureAISearchCredentials();

  const searchClient = new SearchClient<T>(endpoint, indexName, new AzureKeyCredential(apiKey));

  return searchClient;
};

export const AzureAISearchIndexClientInstance = () => {
  const { apiKey, endpoint } = AzureAISearchCredentials();

  const searchClient = new SearchIndexClient(endpoint, new AzureKeyCredential(apiKey));

  return searchClient;
};

/**
 * Wrapper class for Azure AI Search operations.
 */
export class AzureAISearchService<T extends object> {
  private client = AzureAISearchInstance<T>();
  /**
   * Basic search without semantic or vector capabilities.
   */
  async simpleSearch(query?: string, filter?: string, top: number = 10, skip: number = 0): Promise<T[]> {
    const options = { top, filter, skip, queryType: 'simple' as const };
    const results: T[] = [];
    const searchIter = await this.client.search(query, options);
    for await (const res of searchIter.results) {
      results.push(res.highlights ? (res.highlights as unknown as T) : res.document);
    }
    return results;
  }
  /**
   * Semantic search using Azure cognitive semantic ranking (no vector embeddings).
   */
  async semanticSearch(
    query: string,
    top: number = 10,
    filter?: string,
    config: { configurationName?: string; count?: number; threshold?: number } = {},
  ): Promise<T[]> {
    const { configurationName = 'default', count = 1, threshold = 0.7 } = config;
    const options = {
      top,
      filter,
      semanticSearchOptions: {
        configurationName,
        answers: { answerType: 'extractive', count, threshold },
        captions: { captionType: 'extractive' },
      } as SemanticSearchOptions,
      queryType: 'semantic' as const,
    };
    const results: T[] = [];
    const searchIter = await this.client.search(query, options);
    for await (const res of searchIter.results) {
      results.push(res.highlights ? (res.highlights as unknown as T) : res.document);
    }
    return results;
  }
  /**
   * Vector search using OpenAI embeddings and Azure cognitive vector search.
   */
  async vectorSearch(
    query: string,
    top: number = 10,
    filter?: string,
    vectorField: string = 'embedding',
    kNearest: number = 10,
  ): Promise<T[]> {
    const openai = AzureOpenAIEmbeddingInstance();
    const response = await openai.path('/embeddings').post({
      body: {
        input: [query],
        model: process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME!,
      },
    });

    if (isUnexpected(response)) {
      throw response.body.error;
    }

    const vector = response.body.data[0].embedding as number[];
    const options = {
      top,
      filter,
      vectorSearchOptions: {
        queries: [{ vector, fields: [vectorField], kind: 'vector', kNearestNeighborsCount: kNearest }],
      },
    };
    const results: T[] = [];
    const searchIter = await this.client.search(query, options as any);
    for await (const res of searchIter.results) {
      results.push(res.highlights ? (res.highlights as unknown as T) : res.document);
    }
    return results;
  }
  /**
   * Delete documents from the search index.
   * Throws if any deletion fails.
   */
  async deleteDocuments(documents: T[]): Promise<void> {
    const response = await this.client.deleteDocuments(documents);
    const failed = response.results.find((r) => r.succeeded === false);
    if (failed) {
      throw new Error(failed.errorMessage || 'Failed to delete some documents');
    }
  }
}
