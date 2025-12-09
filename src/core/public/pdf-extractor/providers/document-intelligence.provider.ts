import DIClient, { DocumentIntelligenceClient } from '@azure-rest/ai-document-intelligence';

export const DocumentIntelligenceInstance = (): DocumentIntelligenceClient | null => {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !key) {
    console.warn(
      '[DocumentIntelligence] Provider disabled - AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT or AZURE_DOCUMENT_INTELLIGENCE_KEY not set',
    );
    return null;
  }

  // Return a new instance of DocumentIntelligenceClient with the endpoint and credentials
  return DIClient(endpoint, { key });
};
