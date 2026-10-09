import { jest } from '@jest/globals';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let prisma: any;
  let jwtService: any;
  let configService: any;
  let usersService: any;
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      passwordResetToken: {
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      emailVerificationToken: {
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('access-token'),
    };

    configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          JWT_ACCESS_SECRET: 'test-access-secret',
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };

        return config[key] ?? '';
      }),
    };

    usersService = {
      findById: jest.fn(),
      toPublicUser: jest.fn((user) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
        email: user.email,
        emailVerified: user.emailVerified,
        accountStatus: user.accountStatus,
        avatarUrl: user.avatarUrl ?? null,
        createdAt: user.createdAt,
        role: user.role,
      })),
      ensureAccountAllowed: jest.fn(async (user) => user),
    };

    service = new AuthService(prisma, jwtService, configService, usersService);
  });

  it('registers a user and never exposes the password hash in the returned payload', async () => {
    const passwordHash = await argon2.hash('StrongPass123!');
    const user = {
      id: 'user-1',
      email: 'jane@example.com',
      passwordHash,
      firstName: 'Jane',
      lastName: 'Doe',
      displayName: 'Jane Doe',
      avatarUrl: null,
      emailVerified: false,
      accountStatus: 'PENDING_VERIFICATION',
      role: 'USER',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(user);
    prisma.emailVerificationToken.create.mockResolvedValue({ id: 'token-1' });
    prisma.refreshToken.create.mockResolvedValue({ id: 'refresh-1' });
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.register({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'JANE@EXAMPLE.com',
      password: 'StrongPass123!',
    });

    expect(result.user.email).toBe('jane@example.com');
    expect(result.accessToken).toBe('access-token');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects invalid login credentials with a generic message', async () => {
    const passwordHash = await argon2.hash('StrongPass123!');
    const user = {
      id: 'user-2',
      email: 'jane@example.com',
      passwordHash,
      firstName: 'Jane',
      lastName: 'Doe',
      displayName: 'Jane Doe',
      avatarUrl: null,
      emailVerified: true,
      accountStatus: 'ACTIVE',
      role: 'USER',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    prisma.user.findUnique.mockResolvedValue(user);

    await expect(
      service.login(
        { email: 'jane@example.com', password: 'WrongPassword123!' },
        '127.0.0.1',
        'jest-test-agent',
      ),
    ).rejects.toThrow('Invalid email or password.');
  });

  it('issues new tokens for a valid login', async () => {
    const passwordHash = await argon2.hash('StrongPass123!');
    const user = {
      id: 'user-3',
      email: 'jane@example.com',
      passwordHash,
      firstName: 'Jane',
      lastName: 'Doe',
      displayName: 'Jane Doe',
      avatarUrl: null,
      emailVerified: true,
      accountStatus: 'ACTIVE',
      role: 'USER',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    prisma.user.findUnique.mockResolvedValue(user);
    prisma.refreshToken.create.mockResolvedValue({ id: 'refresh-2' });
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.login(
      { email: 'jane@example.com', password: 'StrongPass123!' },
      '127.0.0.1',
      'jest-test-agent',
    );

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeDefined();
    expect(result.user.email).toBe('jane@example.com');
  });

  it('refresh rotation rejects expired or revoked sessions', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(
      service.refresh({ refreshToken: 'not-a-real-token' }, '127.0.0.1', 'jest-test-agent'),
    ).rejects.toThrow('Invalid or expired refresh token.');
  });
});
