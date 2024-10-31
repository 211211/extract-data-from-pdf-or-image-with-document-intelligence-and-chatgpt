import { Module } from '@nestjs/common';
import { PdfExtractorService } from './pdf-extractor.service';
import { PdfExtractorController } from './pdf-extractor.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [PdfExtractorController],
  providers: [PdfExtractorService],
})
export class PdfExtractorModule {}
