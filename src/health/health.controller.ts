import { Controller, Get, Version } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@Controller('health')
@ApiTags('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Version('1')
  @ApiOperation({ summary: 'Check API health and database connectivity' })
  getHealth() {
    return this.healthService.getHealth();
  }
}
