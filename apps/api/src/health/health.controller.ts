import { Controller, Get } from '@nestjs/common';
import { HealthResponse } from '@tutor-app/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      ok: true,
      service: 'api',
      version: process.env.npm_package_version ?? '0.0.0',
    };
  }
}
