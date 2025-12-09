import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { PdfExtractorModule } from './core/public/pdf-extractor/pdf-extractor.module';
import { SearchModule } from './core/public/search/search.module';
import { StreamingModule } from './core/streaming/streaming.module';
import { AgentsModule } from './agents/agents.module';
import { ChatModule } from './chat/chat.module';
import { ObservabilityModule } from './core/observability/observability.module';
import configs from './config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: configs }),
    // Observability (structured logging, metrics)
    ObservabilityModule,
    // Core streaming infrastructure
    StreamingModule,
    // Agents system
    AgentsModule,
    // Chat endpoints
    ChatModule,
    // Existing modules
    PdfExtractorModule,
    SearchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
