import { jest } from '@jest/globals';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns a degraded status when database connectivity is unavailable', async () => {
    const prismaService = { checkDatabaseConnection: jest.fn().mockResolvedValue(false) };
    const service = new HealthService(prismaService as never);

    await expect(service.getHealth()).resolves.toEqual({
      success: true,
      service: 'signvault-api',
      status: 'degraded',
      database: 'unavailable',
    });
  });

  it('returns a healthy status when database connectivity is available', async () => {
    const prismaService = { checkDatabaseConnection: jest.fn().mockResolvedValue(true) };
    const service = new HealthService(prismaService as never);

    await expect(service.getHealth()).resolves.toEqual({
      success: true,
      service: 'signvault-api',
      status: 'healthy',
      database: 'connected',
    });
  });
});
