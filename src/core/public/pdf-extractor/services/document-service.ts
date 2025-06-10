import { AnalyzeOperationOutput, getLongRunningPoller, isUnexpected } from '@azure-rest/ai-document-intelligence';
import { AzureCogDocumentIndex, embedDocuments, ensureIndexIsCreated } from './azure-cog-vector-store';

import { AzureAISearchInstance } from './ai-search';
import { DocumentIntelligenceInstance } from '../providers';
import { chunkDocumentWithOverlap } from './text-chunk';
import { createHash } from 'node:crypto';
import { customAlphabet } from 'nanoid';

export const uniqueId = () => {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const nanoid = customAlphabet(alphabet, 36);
  return nanoid();
};

export const hashValue = (value: string): string => {
  const hash = createHash('sha256');
  hash.update(value);
  return hash.digest('hex');
};

export const userHashedId = async (email: string): Promise<string> => {
  return hashValue(email);
};

const MAX_UPLOAD_DOCUMENT_SIZE: number = 20000000;

export const UploadDocument = async (formData: FormData): Promise<string[]> => {
  await ensureSearchIsConfigured();

  const { docs } = await LoadFile(formData);
  const splitDocuments = await chunkDocumentWithOverlap(docs.join('\n'));
  return splitDocuments;
};

const LoadFile = async (formData: FormData) => {
  try {
    const file: File | null = formData.get('file') as unknown as File;

    if (file && file.size < MAX_UPLOAD_DOCUMENT_SIZE) {
      const client = DocumentIntelligenceInstance();

      // Convert the file to a Base64 string
      const arrayBuffer = await file.arrayBuffer();
      const base64Source = Buffer.from(arrayBuffer).toString('base64');

      // Send the request to analyze the document
      const initialResponse = await client.path('/documentModels/{modelId}:analyze', 'prebuilt-read').post({
        contentType: 'application/json',
        body: {
          base64Source,
        },
        queryParameters: { outputContentFormat: 'markdown' },
      });

      // Check if the response is unexpected (error)
      if (isUnexpected(initialResponse)) {
        const errorMessage = initialResponse.body.error?.message || JSON.stringify(initialResponse.body.error, null, 2);
        throw new Error(`Failed to start analysis: ${errorMessage}`);
      }

      // Use the poller to handle the long-running operation
      const poller = getLongRunningPoller(client, initialResponse);
      const result = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;

      const docs: Array<string> = [];

      // Extract content from paragraphs in the analysis result
      if (result.analyzeResult?.paragraphs) {
        for (const paragraph of result.analyzeResult.paragraphs) {
          docs.push(paragraph.content);
        }
      }

      return { docs };
    } else {
      throw new Error(`File is too large and must be less than ${MAX_UPLOAD_DOCUMENT_SIZE} bytes.`);
    }
  } catch (e) {
    const error = e as any;
    throw new Error(error.message || 'Failed to load and analyze the document.');
  }
};

export const IndexDocuments = async (
  fileName: string,
  docs: string[],
  chatThreadId: string,
): Promise<AzureCogDocumentIndex[]> => {
  const _user = await userHashedId(`quan.nguyen@modec.com`);
  const documentsToIndex = docs.map(
    (doc): AzureCogDocumentIndex => ({
      id: uniqueId(),
      chatThreadId,
      user: _user,
      pageContent: doc,
      metadata: fileName,
      embedding: [],
    }),
  );

  const instance = AzureAISearchInstance();
  await embedDocuments(documentsToIndex);

  const uploadResponse = await instance.uploadDocuments(documentsToIndex);
  console.info('Upload response:', uploadResponse);

  return documentsToIndex;
};

export const isNotNullOrEmpty = (value?: string) => {
  return value !== null && value !== undefined && value !== '';
};

export const ensureSearchIsConfigured = async () => {
  const isSearchConfigured =
    isNotNullOrEmpty(process.env.AZURE_SEARCH_NAME) &&
    isNotNullOrEmpty(process.env.AZURE_SEARCH_API_KEY) &&
    isNotNullOrEmpty(process.env.AZURE_SEARCH_INDEX_NAME) &&
    isNotNullOrEmpty(process.env.AZURE_SEARCH_API_VERSION);

  if (!isSearchConfigured) {
    throw new Error('Azure search environment variables are not configured.');
  }

  const isDocumentIntelligenceConfigured =
    isNotNullOrEmpty(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT) &&
    isNotNullOrEmpty(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY);

  if (!isDocumentIntelligenceConfigured) {
    throw new Error('Azure document intelligence environment variables are not configured.');
  }

  const isEmbeddingsConfigured = isNotNullOrEmpty(process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME);

  if (!isEmbeddingsConfigured) {
    throw new Error('Azure openai embedding variables are not configured.');
  }

  await ensureIndexIsCreated();
};
