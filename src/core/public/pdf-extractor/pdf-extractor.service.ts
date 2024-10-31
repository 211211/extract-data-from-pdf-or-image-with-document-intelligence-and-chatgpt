import { Injectable, Logger, Inject } from '@nestjs/common';
import { IDocumentAnalysisService } from './interfaces/document-analysis.interface';
import { IGptCompletionService } from './interfaces/gpt-completion.interface';
import { PdfExtractorDto } from './dto/pdf-extractor.dto';

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);

  constructor(
    @Inject('DocumentAnalysisService') private readonly documentAnalysisService: IDocumentAnalysisService,
    @Inject('GptCompletionService') private readonly gptCompletionService: IGptCompletionService,
  ) {}

  async extract(file: PdfExtractorDto['file']): Promise<string> {
    try {
      const analysisResult = await this.documentAnalysisService.analyzeDocument(file);
      return await this.gptCompletionService.completeWithGPT(analysisResult);
    } catch (error) {
      this.logger.error('Failed to extract data from PDF', error instanceof Error ? error.message : error);
      throw error;
    }
  }
}
