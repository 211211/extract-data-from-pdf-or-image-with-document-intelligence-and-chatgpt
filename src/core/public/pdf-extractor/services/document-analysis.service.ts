import { Injectable, Inject, Logger, BadRequestException, Optional } from '@nestjs/common';
import {
  DocumentIntelligenceClient,
  isUnexpected,
  getLongRunningPoller,
  AnalyzeOperationOutput,
} from '@azure-rest/ai-document-intelligence';
import { IDocumentAnalysisService } from '../interfaces/document-analysis.interface';
import { PdfExtractorDto } from '../dto/pdf-extractor.dto';
import { DocumentAnalysisConfig } from './document-analysis-config.interface';

@Injectable()
export class DocumentAnalysisService implements IDocumentAnalysisService {
  private readonly logger = new Logger(DocumentAnalysisService.name);

  constructor(
    @Optional()
    @Inject('DocumentIntelligenceClient')
    private readonly documentIntelligenceClient: DocumentIntelligenceClient | null,
  ) {}

  private ensureClientAvailable(): DocumentIntelligenceClient {
    if (!this.documentIntelligenceClient) {
      throw new BadRequestException(
        'Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY environment variables.',
      );
    }
    return this.documentIntelligenceClient;
  }

  /**
   * Analyzes a document (PDF or image) using Azure Document Intelligence.
   * @param file The file to analyze (PDF or image).
   * @param config Optional configuration for analysis settings.
   * @returns The analysis result with extracted content (tables, text, etc.).
   */
  async analyzeDocument(
    file: PdfExtractorDto['file'],
    config: DocumentAnalysisConfig = {
      modelId: 'prebuilt-layout',
      outputContentFormat: 'markdown',
      features: [],
    },
  ): Promise<any> {
    try {
      this.logger.log(`Analyzing file: ${file.originalname}, Type: ${file.mimetype}, Size: ${file.size} bytes`);

      // Validate file type (PDF or supported image types)
      const supportedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'];
      if (!supportedTypes.includes(file.mimetype)) {
        throw new BadRequestException(
          `Unsupported file type: ${file.mimetype}. Supported types: ${supportedTypes.join(', ')}`,
        );
      }

      // Add high-resolution OCR feature for images if not already included
      const isImage = file.mimetype.startsWith('image/');
      if (isImage && !config.features?.includes('ocr.highResolution')) {
        config.features = [...(config.features || []), 'ocr.highResolution'];
        this.logger.log('Added high-resolution OCR feature for image processing');
      }

      // Convert the file buffer to a Base64 string
      const base64Source = file.buffer.toString('base64');

      // Prepare query parameters with output format and features
      const queryParameters: Record<string, any> = {
        outputContentFormat: config.outputContentFormat,
      };
      if (config.features && config.features.length > 0) {
        queryParameters.features = config.features.join(',');
      }
      if (config.apiVersion) {
        queryParameters.apiVersion = config.apiVersion;
      }

      // Send the request to analyze the document
      this.logger.log(`Using model: ${config.modelId} for analysis`);
      const client = this.ensureClientAvailable();
      const initialResponse = await client.path('/documentModels/{modelId}:analyze', config.modelId).post({
        contentType: 'application/json',
        body: {
          base64Source,
        },
        queryParameters,
      });

      // Check if the response is unexpected (error)
      if (isUnexpected(initialResponse)) {
        const errorMessage = initialResponse.body.error?.message || JSON.stringify(initialResponse.body.error, null, 2);
        this.logger.error(`Failed to start analysis: ${errorMessage}`);
        throw new Error(`Failed to start analysis: ${errorMessage}`);
      }

      // Use the poller to handle the long-running operation
      const poller = getLongRunningPoller(client, initialResponse);
      const result = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;

      // Process and log extracted content
      if (result.analyzeResult) {
        // Extract and log tables if available
        if (result.analyzeResult.tables && result.analyzeResult.tables.length > 0) {
          this.logger.log(`Extracted ${result.analyzeResult.tables.length} tables`);
          result.analyzeResult.tables.forEach((table, index) => {
            this.logger.log(`Table ${index + 1}: ${table.rowCount} rows, ${table.columnCount} columns`);
            table.cells.forEach((cell) => {
              this.logger.log(`Cell [${cell.rowIndex},${cell.columnIndex}]: ${cell.content}`);
            });
          });
        } else {
          this.logger.log('No tables found in the document');
        }

        // Log paragraphs or content if markdown/text output is used
        if (result.analyzeResult.content) {
          this.logger.log('Extracted content preview:');
          this.logger.log(result.analyzeResult.content.substring(0, 200) + '...');
        }
      }

      this.logger.log('Document analysis completed successfully');
      return result.analyzeResult;
    } catch (error) {
      this.logger.error('Failed to analyze document', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Convenience method to analyze a document for OCR (text extraction).
   * @param file The file to analyze.
   * @returns The analysis result with extracted text.
   */
  async analyzeDocumentForText(file: PdfExtractorDto['file']): Promise<any> {
    return this.analyzeDocument(file, {
      modelId: 'prebuilt-read',
      outputContentFormat: 'text',
      features: file.mimetype.startsWith('image/') ? ['ocr.highResolution'] : [],
      apiVersion: process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION ?? '2024-11-30',
    });
  }

  /**
   * Convenience method to analyze a document for tables and layout.
   * @param file The file to analyze.
   * @returns The analysis result with extracted tables and layout.
   */
  async analyzeDocumentForTables(file: PdfExtractorDto['file']): Promise<any> {
    return this.analyzeDocument(file, {
      modelId: 'prebuilt-layout',
      outputContentFormat: 'markdown',
      features: file.mimetype.startsWith('image/') ? ['ocr.highResolution'] : [],
      apiVersion: process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION ?? '2024-11-30',
    });
  }
}
