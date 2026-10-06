import { Controller, Get, Version } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('health')
@ApiTags('health')
export class HealthController {
  @Get()
  @Version('1')
  @ApiOperation({ summary: 'Check API health' })
  getHealth() {
    return {
      success: true,
      service: 'signvault-api',
      status: 'healthy',
    };
  }
}
