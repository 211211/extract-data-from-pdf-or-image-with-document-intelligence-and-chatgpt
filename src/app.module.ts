import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import configs from './config';
import { PdfExtractorModule } from './core/public/pdf-extractor/pdf-extractor.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: configs }), PdfExtractorModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
