import { IndexerService } from './indexer.service';
import { Module } from '@nestjs/common';
import { PdfExtractorModule } from '../pdf-extractor/pdf-extractor.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [PdfExtractorModule],
  providers: [SearchService, IndexerService],
  controllers: [SearchController],
})
export class SearchModule {}
