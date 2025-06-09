import { DocumentIntelligenceInstance, Grok3Instance } from './providers';

import { CompletionService } from './services/completion.interface';
import { DocumentAnalysisService } from './services/document-analysis.service';
import { Module } from '@nestjs/common';
import { PdfExtractorController } from './pdf-extractor.controller';
import { PdfExtractorService } from './pdf-extractor.service';

@Module({
  imports: [],
  controllers: [PdfExtractorController],
  providers: [
    PdfExtractorService,
    DocumentAnalysisService,
    CompletionService,
    { provide: 'DocumentIntelligenceClient', useFactory: DocumentIntelligenceInstance },
    { provide: 'ModelClient', useFactory: Grok3Instance },
    { provide: 'DocumentAnalysisService', useClass: DocumentAnalysisService },
    { provide: 'CompletionService', useClass: CompletionService },
  ],
  exports: [PdfExtractorService],
})
export class PdfExtractorModule {}
