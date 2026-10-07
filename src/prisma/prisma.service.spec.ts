import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('exposes the Prisma client as a NestJS service', () => {
    const service = new PrismaService();

    expect(service).toBeInstanceOf(PrismaClient);
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
  });
});
