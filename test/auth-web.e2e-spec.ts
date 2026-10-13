import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { WEB_AUTH_COOKIE_PATH, WEB_REFRESH_COOKIE_NAME } from '../src/auth/web-session';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';

describe('Browser auth API (e2e)', () => {
  let app: INestApplication;
  let users: Map<string, any>;
  let refreshTokens: Map<string, any>;
  let prisma: any;
  const config = {
    FRONTEND_URL: 'http://localhost:3000',
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_ACCESS_EXPIRES_IN: '900',
    JWT_REFRESH_EXPIRES_IN: '604800',
    AUTH_COOKIE_SAME_SITE: 'lax',
  };

  const origin = config.FRONTEND_URL;

  function cookieValue(setCookie: string | string[]) {
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return header.split(';', 1)[0];
  }

  function assertCookieAttributes(setCookie: string | string[]) {
    const header = (Array.isArray(setCookie) ? setCookie[0] : setCookie).toLowerCase();
    const attributes = header.slice(header.indexOf(';') + 1);
    expect(attributes).toContain('httponly');
    expect(attributes).toContain('secure');
    expect(attributes).toContain('samesite=lax');
    expect(attributes).toContain(`path=${WEB_AUTH_COOKIE_PATH.toLowerCase()}`);
    expect(attributes).toMatch(/max-age=60479[9]|max-age=604800/);
    expect(attributes).toContain('expires=');
  }

  beforeAll(async () => {
    const passwordHash = await argon2.hash('StrongPass123!');
    users = new Map();
    const existingUser = {
      id: 'user-1',
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
    users.set(existingUser.email, existingUser);
    users.set(existingUser.id, existingUser);
    refreshTokens = new Map();

    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => users.get(where.email ?? where.id) ?? null),
        create: jest.fn(async ({ data }: any) => {
          const user = {
            ...data,
            id: `user-${users.size}`,
            avatarUrl: null,
            emailVerified: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          users.set(user.email, user);
          users.set(user.id, user);
          return user;
        }),
      },
      refreshToken: {
        create: jest.fn(async ({ data }: any) => {
          const session = { ...data, id: `refresh-${refreshTokens.size}`, revokedAt: null };
          refreshTokens.set(data.tokenHash, session);
          return session;
        }),
        findUnique: jest.fn(async ({ where }: any) => refreshTokens.get(where.tokenHash) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const session = [...refreshTokens.values()].find((value) => value.id === where.id);
          Object.assign(session, data);
          return session;
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      emailVerificationToken: { create: jest.fn(async () => ({ id: 'verification-1' })) },
      passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      auditLog: { create: jest.fn(async () => ({})) },
    };

    const usersService = {
      ensureAccountAllowed: jest.fn(async (user: any) => user),
      toPublicUser: jest.fn((user: any) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
        accountStatus: user.accountStatus,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
        role: user.role,
      })),
    };
    const configService = { get: (key: string) => config[key as keyof typeof config] ?? '' };

    const moduleFixture = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn(async () => 'short-lived-access-token') } },
        { provide: ConfigService, useValue: configService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('logs in, rotates cookies, rejects replay, and logs out the active session', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/web/login')
      .set('Origin', origin)
      .send({ email: 'jane@example.com', password: 'StrongPass123!' })
      .expect(201);

    expect(login.body.accessToken).toBeDefined();
    expect(login.body.accessExpiresAt).toBeDefined();
    expect(Object.hasOwn(login.body, 'refreshToken')).toBe(false);
    expect(login.headers['set-cookie']).toBeDefined();
    assertCookieAttributes(login.headers['set-cookie']);
    const firstCookie = cookieValue(login.headers['set-cookie']);
    expect(firstCookie.startsWith(`${WEB_REFRESH_COOKIE_NAME}=`)).toBe(true);

    const firstRefresh = await request(app.getHttpServer())
      .post('/api/v1/auth/web/refresh')
      .set('Origin', origin)
      .set('Cookie', firstCookie)
      .expect(201);
    expect(firstRefresh.body.accessToken).toBeDefined();
    expect(Object.hasOwn(firstRefresh.body, 'refreshToken')).toBe(false);
    assertCookieAttributes(firstRefresh.headers['set-cookie']);
    const secondCookie = cookieValue(firstRefresh.headers['set-cookie']);

    await request(app.getHttpServer())
      .post('/api/v1/auth/web/refresh')
      .set('Origin', origin)
      .set('Cookie', firstCookie)
      .expect(401);

    const secondRefresh = await request(app.getHttpServer())
      .post('/api/v1/auth/web/refresh')
      .set('Origin', origin)
      .set('Cookie', secondCookie)
      .expect(201);
    expect(Object.hasOwn(secondRefresh.body, 'refreshToken')).toBe(false);
    const activeCookie = cookieValue(secondRefresh.headers['set-cookie']);

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/web/logout')
      .set('Origin', origin)
      .set('Cookie', activeCookie)
      .expect(201);
    expect(logout.body.success).toBe(true);
    const clearedCookie = logout.headers['set-cookie'][0].toLowerCase();
    expect(clearedCookie).toContain(`${WEB_REFRESH_COOKIE_NAME}=;`);
    expect(clearedCookie).toContain(`path=${WEB_AUTH_COOKIE_PATH.toLowerCase()}`);
    expect(clearedCookie).toContain('httponly');
    expect(clearedCookie).toContain('secure');
    expect(clearedCookie).toContain('samesite=lax');

    await request(app.getHttpServer())
      .post('/api/v1/auth/web/refresh')
      .set('Origin', origin)
      .set('Cookie', activeCookie)
      .expect(401);
  });

  it('registers a browser user without returning the refresh token in JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/web/register')
      .set('Origin', origin)
      .send({
        firstName: 'Rae',
        lastName: 'Example',
        email: 'rae@example.com',
        password: 'StrongPass123!',
      })
      .expect(201);

    expect(response.body.accessToken).toBeDefined();
    expect(Object.hasOwn(response.body, 'refreshToken')).toBe(false);
    assertCookieAttributes(response.headers['set-cookie']);
  });

  it('rejects missing, invalid, and unexpected browser origins', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/web/login')
      .send({ email: 'jane@example.com', password: 'StrongPass123!' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/auth/web/login')
      .set('Origin', 'https://attacker.example')
      .send({ email: 'jane@example.com', password: 'StrongPass123!' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/auth/web/refresh')
      .set('Origin', origin)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/web/refresh')
      .set('Origin', origin)
      .set('Cookie', `${WEB_REFRESH_COOKIE_NAME}=invalid`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/web/refresh')
      .set('Origin', 'https://attacker.example')
      .set('Cookie', `${WEB_REFRESH_COOKIE_NAME}=invalid`)
      .expect(403);
  });
});