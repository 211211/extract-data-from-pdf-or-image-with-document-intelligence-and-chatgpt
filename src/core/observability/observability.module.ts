import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { LoggingInterceptor } from './logging.interceptor';
import { LangfuseService } from './langfuse.service';

/**
 * ObservabilityModule
 *
 * Provides observability features:
 * - Structured logging with trace IDs
 * - Prometheus metrics
 * - Langfuse LLM observability (self-hosted MIT version)
 * - Health checks
 *
 * Global module - MetricsService and LangfuseService available throughout the app.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    LangfuseService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
  exports: [MetricsService, LangfuseService],
})
export class ObservabilityModule {}
