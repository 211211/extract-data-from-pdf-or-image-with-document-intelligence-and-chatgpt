import { Injectable, Logger, Inject } from '@nestjs/common';
import { IDocumentAnalysisService } from './interfaces/document-analysis.interface';
import { PdfExtractorDto } from './dto/pdf-extractor.dto';
import { ICompletionService } from './interfaces/completion.interface';

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);

  constructor(
    @Inject('DocumentAnalysisService') private readonly documentAnalysisService: IDocumentAnalysisService,
    @Inject('CompletionService') private readonly completionService: ICompletionService,
  ) {}

  async extract(file: PdfExtractorDto['file']): Promise<string> {
    const analysisResult = await this.documentAnalysisService.analyzeDocument(file);
    return await this.completionService.chatCompletion(analysisResult);
  }
}
