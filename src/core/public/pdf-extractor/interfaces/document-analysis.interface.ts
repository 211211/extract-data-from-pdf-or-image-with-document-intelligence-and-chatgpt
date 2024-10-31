import { AnalyzeResult } from '@azure/ai-form-recognizer';
import { PdfExtractorDto } from '../dto/pdf-extractor.dto';

export interface IDocumentAnalysisService {
  analyzeDocument(file: PdfExtractorDto['file']): Promise<AnalyzeResult>;
}
