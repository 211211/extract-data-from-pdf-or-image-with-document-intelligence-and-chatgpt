import { AnalyzeOperationOutput } from '@azure-rest/ai-document-intelligence';
import { DocumentAnalysisConfig } from '../services/document-analysis-config.interface';
import { PdfExtractorDto } from '../dto/pdf-extractor.dto';

export interface IDocumentAnalysisService {
  analyzeDocument(file: PdfExtractorDto['file'], config?: DocumentAnalysisConfig): Promise<AnalyzeOperationOutput>;
  analyzeDocumentForText(file: PdfExtractorDto['file']): Promise<AnalyzeOperationOutput>;
  analyzeDocumentForTables(file: PdfExtractorDto['file']): Promise<AnalyzeOperationOutput>;
}
