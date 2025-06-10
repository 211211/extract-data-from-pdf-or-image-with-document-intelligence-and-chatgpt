import { AzureAISearchIndexClientInstance, AzureAISearchService } from './ai-search';

import { AzureOpenAIEmbeddingInstance } from '../providers';
import { SearchIndex } from '@azure/search-documents';
import { isUnexpected } from '@azure-rest/ai-inference';

export interface AzureCogDocumentIndex {
  id: string;
  pageContent: string;
  embedding?: number[];
  user: string;
  chatThreadId: string;
  metadata: string;
}

interface DocumentSearchResponseModel<TModel> {
  value: TModel[];
}

/** Basic term-based search (no semantic or vector capabilities) */
export const simpleSearch = (searchText?: string, filter?: string): Promise<AzureCogDocumentIndex[]> =>
  new AzureAISearchService<AzureCogDocumentIndex>().simpleSearch(searchText, filter);

/** Vector search using OpenAI embeddings via Azure cognitive vector search */
export const vectorSearch = (searchText: string, k: number = 10, filter?: string): Promise<AzureCogDocumentIndex[]> =>
  new AzureAISearchService<AzureCogDocumentIndex>().vectorSearch(searchText, k, filter);
/** Semantic search using Azure cognitive semantic ranking (no external embeddings) */
export const semanticSearch = (
  searchText: string,
  top: number = 10,
  filter?: string,
): Promise<AzureCogDocumentIndex[]> =>
  new AzureAISearchService<AzureCogDocumentIndex>().semanticSearch(searchText, top, filter);

export const indexDocuments = async (documents: Array<AzureCogDocumentIndex>): Promise<void> => {
  const url = `${baseIndexUrl()}/docs/index?api-version=${process.env.AZURE_SEARCH_API_VERSION}`;

  await embedDocuments(documents);
  console.log(`Indexing ${documents.length} documents into Azure Search`);
  // console.dir({ documents }, { depth: null });
  const documentIndexRequest: DocumentSearchResponseModel<AzureCogDocumentIndex> = {
    value: documents,
  };
  console.log('Document index request:', documentIndexRequest, { depth: null });

  await fetcher(url, {
    method: 'POST',
    body: JSON.stringify(documentIndexRequest),
  });
};

export const deleteDocuments = async (chatThreadId: string): Promise<void> => {
  const documentsInChat = await simpleSearch(undefined, `chatThreadId eq '${chatThreadId}'`);
  if (!Array.isArray(documentsInChat) || documentsInChat.length === 0) {
    return;
  }
  await new AzureAISearchService<AzureCogDocumentIndex>().deleteDocuments(documentsInChat);
};

export const embedDocuments = async (documents: Array<AzureCogDocumentIndex>) => {
  const openai = AzureOpenAIEmbeddingInstance();

  try {
    const contentsToEmbed = documents.map((d) => d.pageContent);

    const response = await openai.path('/embeddings').post({
      body: {
        input: contentsToEmbed,
        model: process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME!,
      },
    });

    if (isUnexpected(response)) {
      throw response.body.error;
    }

    response.body.data.forEach((embedding, index) => {
      if (Array.isArray(embedding.embedding)) {
        documents[index].embedding = embedding.embedding;
      } else {
        documents[index].embedding = [];
      }
    });
  } catch (e) {
    const error = e as any;
    throw error;
  }
};

/**
 * Generate embedding vector for a single query string using OpenAI embeddings.
 * @param query The input text to embed.
 * @returns A promise resolving to the embedding vector.
 */
export const embedQuery = async (query: string): Promise<number[]> => {
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
  const data = response.body.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Embedding response missing data');
  }
  const emb = data[0].embedding;
  if (!Array.isArray(emb)) {
    throw new Error('Invalid embedding format');
  }
  return emb;
};

const baseIndexUrl = (): string => {
  return `https://${process.env.AZURE_SEARCH_NAME}.search.windows.net/indexes/${process.env.AZURE_SEARCH_INDEX_NAME}`;
};

const fetcher = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.AZURE_SEARCH_API_KEY,
    },
  });

  if (!response.ok) {
    if (response.status === 400) {
      const err = await response.json();
      throw new Error(err.error.message);
    } else {
      throw new Error(`Azure Cog Search Error: ${response.statusText}`);
    }
  }

  return await response.json();
};

export const ensureIndexIsCreated = async (): Promise<void> => {
  try {
    const client = AzureAISearchIndexClientInstance();
    await client.getIndex(process.env.AZURE_SEARCH_INDEX_NAME);
  } catch {
    await createCogSearchIndex();
  }
};

const createCogSearchIndex = async (): Promise<void> => {
  const client = AzureAISearchIndexClientInstance();
  await client.createIndex(AZURE_SEARCH_INDEX);
};

/**
 * Delete and recreate the Azure Search index.
 */
export const resetIndex = async (): Promise<void> => {
  const client = AzureAISearchIndexClientInstance();
  try {
    await client.deleteIndex(process.env.AZURE_SEARCH_INDEX_NAME!);
  } catch {
    // ignore if index does not exist
  }
  await client.createIndex(AZURE_SEARCH_INDEX);
};

/**
 * Remove all documents from the specified Azure Search index.
 * @param indexName Name of the Azure Search index (optional, defaults to environment variable)
 */
export const clearIndex = async (indexName: string = process.env.AZURE_SEARCH_INDEX_NAME!): Promise<void> => {
  try {
    const service = new AzureAISearchService<AzureCogDocumentIndex>();
    let skip = 0;
    const pageSize = 1000; // Maximum number of documents to retrieve per request
    let allDocsDeleted = false;

    while (!allDocsDeleted) {
      // Retrieve a page of documents using simpleSearch with pagination
      const documents = await service.simpleSearch(undefined, undefined, pageSize, skip);

      // If no documents are returned, we are done
      if (!Array.isArray(documents) || documents.length === 0) {
        allDocsDeleted = true;
        break;
      }

      // Delete the current batch of documents
      await service.deleteDocuments(documents);

      // Update skip to fetch the next batch
      skip += pageSize;
    }

    console.log(`Successfully cleared all documents from index: ${indexName}`);
  } catch (error) {
    console.error(`Error clearing index ${indexName}:`, error);
    throw new Error(`Failed to clear index ${indexName}: ${error.message || error}`);
  }
};

const AZURE_SEARCH_INDEX: SearchIndex = {
  name: process.env.AZURE_SEARCH_INDEX_NAME,
  fields: [
    {
      name: 'id',
      type: 'Edm.String',
      key: true,
      filterable: true,
    },
    {
      name: 'user',
      type: 'Edm.String',
      searchable: true,
      filterable: true,
    },
    {
      name: 'chatThreadId',
      type: 'Edm.String',
      searchable: true,
      filterable: true,
    },
    {
      name: 'pageContent',
      searchable: true,
      type: 'Edm.String',
    },
    {
      name: 'metadata',
      type: 'Edm.String',
    },
    {
      name: 'embedding',
      type: 'Collection(Edm.Single)',
      searchable: true,
      filterable: false,
      sortable: false,
      facetable: false,
      vectorSearchDimensions: 3072,
      vectorSearchProfileName: 'vectorConfig-profile',
    },
  ],
  vectorSearch: {
    algorithms: [
      {
        name: 'vectorConfig',
        kind: 'hnsw',
        parameters: {
          m: 4,
          efConstruction: 200,
          efSearch: 200,
          metric: 'cosine',
        },
      },
    ],
    profiles: [
      {
        name: 'vectorConfig-profile',
        algorithmConfigurationName: 'vectorConfig',
      },
    ],
  },
};

/**
 * Retrieve all documents from the specified Azure Search index.
 * @param indexName Name of the Azure Search index (optional, defaults to environment variable AZURE_SEARCH_INDEX_NAME)
 * @returns Promise resolving to an array of all documents in the index
 */
export const getAllDocuments = async (
  indexName: string = process.env.AZURE_SEARCH_INDEX_NAME!,
): Promise<AzureCogDocumentIndex[]> => {
  try {
    if (!indexName) {
      throw new Error(
        'Index name must be provided either as argument or via AZURE_SEARCH_INDEX_NAME environment variable',
      );
    }

    const service = new AzureAISearchService<AzureCogDocumentIndex>();
    let skip = 0;
    const pageSize = 1000; // Maximum number of documents to retrieve per request, adjust if needed
    let allDocuments: AzureCogDocumentIndex[] = [];
    let hasMoreDocuments = true;

    while (hasMoreDocuments) {
      // Retrieve a page of documents using simpleSearch with pagination
      const documents = await service.simpleSearch(undefined, undefined, pageSize, skip);

      // If no documents are returned, we are done
      if (!Array.isArray(documents) || documents.length === 0) {
        hasMoreDocuments = false;
        break;
      }

      // Add the current batch of documents to the result array
      allDocuments = allDocuments.concat(documents);

      // Update skip to fetch the next batch
      skip += pageSize;
    }

    console.log(`Retrieved ${allDocuments.length} documents from index: ${indexName}`);
    return allDocuments;
  } catch (error) {
    console.error(`Error retrieving documents from index ${indexName}:`, error);
    throw new Error(`Failed to retrieve documents from index ${indexName}: ${error.message || error}`);
  }
};

// Update the AzureCogVectorStoreAction type to include the new action
export type AzureCogVectorStoreAction =
  | { type: 'simpleSearch'; searchText?: string; filter?: string }
  | { type: 'vectorSearch'; searchText: string; k?: number; filter?: string }
  | { type: 'semanticSearch'; searchText: string; top?: number; filter?: string }
  | { type: 'indexDocuments'; documents: AzureCogDocumentIndex[] }
  | { type: 'deleteDocuments'; chatThreadId: string }
  | { type: 'embedDocuments'; documents: AzureCogDocumentIndex[] }
  | { type: 'ensureIndexIsCreated' }
  | { type: 'resetIndex' }
  | { type: 'clearIndex'; indexName?: string }
  | { type: 'getAllDocuments'; indexName?: string };

// Update the main function to handle the new action
export async function main(action: AzureCogVectorStoreAction): Promise<AzureCogDocumentIndex[] | void> {
  switch (action.type) {
    case 'simpleSearch':
      return simpleSearch(action.searchText, action.filter);
    case 'vectorSearch':
      return vectorSearch(action.searchText, action.k, action.filter);
    case 'semanticSearch':
      return semanticSearch(action.searchText, action.top, action.filter);
    case 'indexDocuments':
      return indexDocuments(action.documents);
    case 'deleteDocuments':
      return deleteDocuments(action.chatThreadId);
    case 'embedDocuments':
      return embedDocuments(action.documents);
    case 'ensureIndexIsCreated':
      return ensureIndexIsCreated();
    case 'resetIndex':
      return resetIndex();
    case 'clearIndex':
      if (action.indexName) {
        return clearIndex(action.indexName);
      }
      return clearIndex();
    case 'getAllDocuments':
      if (action.indexName) {
        return getAllDocuments(action.indexName);
      }
      return getAllDocuments();
    default:
      // Exhaustive check
      const _exhaustive: never = action;
      throw new Error(`Unsupported action type: ${(_exhaustive as any).type}`);
  }
}
