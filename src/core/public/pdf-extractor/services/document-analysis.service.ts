import { Injectable, Inject, Logger } from '@nestjs/common';
import { DocumentAnalysisClient, AnalyzeResult } from '@azure/ai-form-recognizer';
import { IDocumentAnalysisService } from '../interfaces/document-analysis.interface';
import { PdfExtractorDto } from '../dto/pdf-extractor.dto';

@Injectable()
export class DocumentAnalysisService implements IDocumentAnalysisService {
  private readonly logger = new Logger(DocumentAnalysisService.name);

  constructor(
    @Inject('DocumentIntelligenceClient') private readonly documentIntelligenceClient: DocumentAnalysisClient, // Injecting the client here
  ) {}

  async analyzeDocument(file: PdfExtractorDto['file']): Promise<AnalyzeResult> {
    try {
      const blob = new Blob([file.buffer], { type: file.mimetype });
      const poller = await this.documentIntelligenceClient.beginAnalyzeDocument(
        'prebuilt-read',
        await blob.arrayBuffer(),
      );
      return await poller.pollUntilDone();
    } catch (error) {
      this.logger.error('Failed to analyze document', error instanceof Error ? error.message : error);
      throw error;
    }
  }
}
