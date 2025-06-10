import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DocumentIntelligenceClient,
  isUnexpected,
  getLongRunningPoller,
  AnalyzeOperationOutput,
} from '@azure-rest/ai-document-intelligence';
import { IDocumentAnalysisService } from '../interfaces/document-analysis.interface';
import { PdfExtractorDto } from '../dto/pdf-extractor.dto';

@Injectable()
export class DocumentAnalysisService implements IDocumentAnalysisService {
  private readonly logger = new Logger(DocumentAnalysisService.name);

  constructor(
    @Inject('DocumentIntelligenceClient') private readonly documentIntelligenceClient: DocumentIntelligenceClient,
  ) {}

  async analyzeDocument(file: PdfExtractorDto['file']): Promise<any> {
    try {
      this.logger.log(`Analyzing file: ${file.originalname}, Type: ${file.mimetype}, Size: ${file.size} bytes`);

      // Convert the file buffer to a Base64 string
      const base64Source = file.buffer.toString('base64');

      // Send the request to analyze the document
      const initialResponse = await this.documentIntelligenceClient
        .path('/documentModels/{modelId}:analyze', 'prebuilt-read')
        .post({
          contentType: 'application/json',
          body: {
            base64Source,
          },
          queryParameters: { outputContentFormat: 'markdown' },
        });

      // Check if the response is unexpected (error)
      if (isUnexpected(initialResponse)) {
        const errorMessage = initialResponse.body.error?.message || JSON.stringify(initialResponse.body.error, null, 2);
        this.logger.error(`Failed to start analysis: ${errorMessage}`);
        throw new Error(`Failed to start analysis: ${errorMessage}`);
      }

      // Use the poller to handle the long-running operation
      const poller = getLongRunningPoller(this.documentIntelligenceClient, initialResponse);
      const result = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;

      this.logger.log('Document analysis completed successfully');
      return result.analyzeResult;
    } catch (error) {
      this.logger.error('Failed to analyze document', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
