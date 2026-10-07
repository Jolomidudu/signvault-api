import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    if (!process.env.DATABASE_URL) {
      this.logger.warn(
        'DATABASE_URL is not configured; Prisma will remain disconnected until a Neon PostgreSQL connection is supplied.',
      );
      return;
    }

    await this.$connect();
  }

  async onModuleDestroy() {
    if (!process.env.DATABASE_URL) {
      return;
    }

    await this.$disconnect();
  }

  async checkDatabaseConnection() {
    if (!process.env.DATABASE_URL) {
      return false;
    }

    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(`Database connectivity check failed: ${(error as Error).message}`);
      return false;
    }
  }
}
