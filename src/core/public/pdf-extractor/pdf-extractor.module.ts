import { DocumentIntelligenceInstance, OpenAIInstance } from './providers';

import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PdfExtractorController } from './pdf-extractor.controller';
import { PdfExtractorService } from './pdf-extractor.service';

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [PdfExtractorController],
  providers: [
    PdfExtractorService,
    { provide: 'OpenAIClient', useFactory: OpenAIInstance },
    { provide: 'DocumentIntelligenceClient', useFactory: DocumentIntelligenceInstance },
  ],
})
export class PdfExtractorModule {}
