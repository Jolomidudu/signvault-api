import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async getHealth() {
    const database = await this.prismaService.checkDatabaseConnection();

    if (!database) {
      this.logger.warn('Database connectivity is unavailable; health status will be reported as degraded.');
    }

    return {
      success: true,
      service: 'signvault-api',
      status: database ? 'healthy' : 'degraded',
      ...(database ? { database: 'connected' } : { database: 'unavailable' }),
    };
  }
}
