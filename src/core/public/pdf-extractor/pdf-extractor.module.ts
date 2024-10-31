import { DocumentIntelligenceInstance, OpenAIInstance } from './providers';

import { DocumentAnalysisService } from './services/document-analysis.service';
import { GptCompletionService } from './services/gpt-completion.service';
import { Module } from '@nestjs/common';
import { PdfExtractorController } from './pdf-extractor.controller';
import { PdfExtractorService } from './pdf-extractor.service';

@Module({
  controllers: [PdfExtractorController],
  providers: [
    PdfExtractorService,
    DocumentAnalysisService,
    GptCompletionService,
    { provide: 'DocumentIntelligenceClient', useFactory: DocumentIntelligenceInstance }, // Register DocumentIntelligenceClient
    { provide: 'OpenAIClient', useFactory: OpenAIInstance }, // Register OpenAIClient
    { provide: 'DocumentAnalysisService', useClass: DocumentAnalysisService },
    { provide: 'GptCompletionService', useClass: GptCompletionService },
  ],
})
export class PdfExtractorModule {}
