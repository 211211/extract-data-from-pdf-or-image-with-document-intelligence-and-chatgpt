import { Injectable } from '@nestjs/common';

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
}

@Injectable()
export class AppService {
  private readonly startTime = Date.now();

  getHello(): string {
    return 'Hello World!';
  }

  getHealth(): HealthCheckResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
    };
  }
}
