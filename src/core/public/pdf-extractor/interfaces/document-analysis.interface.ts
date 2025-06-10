import { AnalyzeOperationOutput } from '@azure-rest/ai-document-intelligence';
import { PdfExtractorDto } from '../dto/pdf-extractor.dto';

export interface IDocumentAnalysisService {
  analyzeDocument(file: PdfExtractorDto['file']): Promise<AnalyzeOperationOutput>;
}
