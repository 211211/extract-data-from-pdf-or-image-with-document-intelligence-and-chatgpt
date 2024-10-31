import { AzureKeyCredential, DocumentAnalysisClient } from '@azure/ai-form-recognizer';

import { PdfExtractorDto } from './dto/pdf-extractor.dto';

export const DocumentIntelligenceInstance = () => {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !key) {
    throw new Error('One or more Document Intelligence environment variables are not set');
  }

  return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
};

export const loadFile = async (file: PdfExtractorDto['file']) => {
  const client = DocumentIntelligenceInstance();
  const blob = new Blob([file.buffer], { type: file.mimetype });
  const poller = await client.beginAnalyzeDocument('prebuilt-read', await blob.arrayBuffer());
  return poller.pollUntilDone();
};
