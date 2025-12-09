import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProduces } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

/**
 * Metrics Controller
 *
 * Exposes Prometheus-compatible metrics at /metrics endpoint.
 * Used by Prometheus server for scraping.
 */
@ApiTags('Observability')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get Prometheus metrics',
    description: 'Returns all metrics in Prometheus text format',
  })
  @ApiProduces('text/plain')
  @ApiResponse({ status: 200, description: 'Metrics in Prometheus format' })
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): string {
    return this.metricsService.getMetrics();
  }
}
