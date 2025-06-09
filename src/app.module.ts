import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { PdfExtractorModule } from './core/public/pdf-extractor/pdf-extractor.module';
import { SearchModule } from './core/public/search/search.module';
import configs from './config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: configs }), PdfExtractorModule, SearchModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
