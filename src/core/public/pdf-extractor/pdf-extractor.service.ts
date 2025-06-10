import { Injectable, Logger, Inject } from '@nestjs/common';
import { IDocumentAnalysisService } from './interfaces/document-analysis.interface';
import { PdfExtractorDto } from './dto/pdf-extractor.dto';
import { ICompletionService } from './interfaces/completion.interface';
import { DocumentAnalysisConfig } from './services/document-analysis-config.interface';

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);

  constructor(
    @Inject('DocumentAnalysisService')
    private readonly documentAnalysisService: IDocumentAnalysisService,
    @Inject('CompletionService')
    private readonly completionService: ICompletionService,
  ) {}

  /**
   * Extracts content from a PDF or image file and processes it with a completion service.
   * @param file The file to analyze (PDF or image).
   * @param mode The analysis mode ('text' for OCR, 'tables' for layout/tables).
   * @returns The processed result from the completion service.
   */
  async extract(file: PdfExtractorDto['file'], mode: 'text' | 'tables' = 'tables'): Promise<string> {
    try {
      this.logger.log(`Starting extraction for file: ${file.originalname}, Mode: ${mode}`);

      // Choose configuration based on mode
      const config: DocumentAnalysisConfig = {
        modelId: mode === 'text' ? 'prebuilt-read' : 'prebuilt-layout',
        outputContentFormat: mode === 'text' ? 'text' : 'markdown',
        features: file.mimetype.startsWith('image/') ? ['ocr.highResolution'] : [],
        apiVersion: process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION!,
      };

      // Analyze the document using the specified configuration
      const analysisResult = await this.documentAnalysisService.analyzeDocument(file, config);

      // Pass the analysis result to the completion service for further processing
      const completionResult = await this.completionService.chatCompletion(analysisResult);

      this.logger.log(`Extraction and completion successful for ${file.originalname}`);
      return completionResult;
    } catch (error) {
      this.logger.error(
        `Extraction failed for ${file.originalname}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Convenience method to extract text content (OCR) from a file.
   * @param file The file to analyze.
   * @returns The processed result from the completion service.
   */
  async extractText(file: PdfExtractorDto['file']): Promise<string> {
    return this.extract(file, 'text');
  }

  /**
   * Convenience method to extract tables and layout from a file.
   * @param file The file to analyze.
   * @returns The processed result from the completion service.
   */
  async extractTables(file: PdfExtractorDto['file']): Promise<string> {
    return this.extract(file, 'tables');
  }
}
