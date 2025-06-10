import DIClient, { DocumentIntelligenceClient } from '@azure-rest/ai-document-intelligence';

export const DocumentIntelligenceInstance = (): DocumentIntelligenceClient => {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !key) {
    throw new Error('Document Intelligence environment variables are missing');
  }

  // Return a new instance of DocumentIntelligenceClient with the endpoint and credentials
  return DIClient(endpoint, { key });
};
