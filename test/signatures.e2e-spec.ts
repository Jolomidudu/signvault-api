import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Signature Vault API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const createdUserIds = new Set<string>();

  const uniqueEmail = (suffix: string) => `vault-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  const createTestUser = async (suffix: string) => {
    const email = uniqueEmail(suffix);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test-only-hash',
        firstName: 'Test',
        lastName: 'User',
        displayName: 'Test User',
        emailVerified: true,
        accountStatus: 'ACTIVE',
      },
    });
    createdUserIds.add(user.id);
    const accessToken = await jwtService.signAsync({ sub: user.id, email: user.email, role: user.role });
    return {
      user,
      accessToken,
    };
  };

  const createSignature = (token: string, payload: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/signatures')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Professional',
        category: 'PROFESSIONAL',
        ...payload,
      });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
  });

  afterEach(async () => {
    for (const userId of createdUserIds) {
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.signature.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    createdUserIds.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests to the signatures collection', async () => {
    await request(app.getHttpServer()).get('/api/v1/signatures').expect(401);
  });

  it('creates a signature for the authenticated user and rejects spoofed userId', async () => {
    const { user, accessToken } = await createTestUser('create');

    const response = await createSignature(accessToken).expect(201);

    expect(response.body).toMatchObject({
      name: 'Professional',
      category: 'PROFESSIONAL',
      status: 'ACTIVE',
    });
    expect(response.body.userId).toBeUndefined();

    const signature = await prisma.signature.findFirst({ where: { id: response.body.id, userId: user.id } });
    expect(signature).not.toBeNull();

    await createSignature(accessToken, { userId: 'not-allowed' }).expect(400);
  });

  it('validates create input and rejects client-controlled status', async () => {
    const { accessToken } = await createTestUser('validation');

    await createSignature(accessToken, { category: 'UNKNOWN' }).expect(400);
    await createSignature(accessToken, { status: 'ARCHIVED' }).expect(400);
    await createSignature(accessToken, { name: '   ' }).expect(400);
  });

  it('lists only the authenticated user signatures and supports filtering and pagination', async () => {
    const { user, accessToken } = await createTestUser('list');
    const otherUser = await createTestUser('other-list');

    await createSignature(accessToken, { name: 'Work Signature', category: 'PROFESSIONAL' });
    await createSignature(accessToken, { name: 'Personal Brand', category: 'PERSONAL' });
    await createSignature(otherUser.accessToken, { name: 'Work Signature', category: 'PROFESSIONAL' });

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/signatures?category=PROFESSIONAL&search=work&limit=1&page=1')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(listResponse.body.items).toHaveLength(1);
    expect(listResponse.body.page).toBe(1);
    expect(listResponse.body.limit).toBe(1);
    expect(listResponse.body.items[0].category).toBe('PROFESSIONAL');
    expect(listResponse.body.total).toBe(1);
    expect(listResponse.body.items[0].name).toBe('Work Signature');
    expect(user.id).not.toBe(otherUser.user.id);
  });

  it('enforces the 25-signature vault limit', async () => {
    const { user, accessToken } = await createTestUser('limit');
    await prisma.signature.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        userId: user.id,
        name: `Signature ${index + 1}`,
        category: 'PROFESSIONAL' as const,
        status: 'ACTIVE' as const,
      })),
    });

    const response = await createSignature(accessToken, { name: 'Signature 26' }).expect(409);
    expect(response.body.message).toMatch(/limit|maximum/i);
    expect(response.body.code).toBe('SIGNATURE_LIMIT_REACHED');
  });

  it('allows archive and restore operations for the owner, and rejects revoked restore', async () => {
    const { user, accessToken } = await createTestUser('status');
    const otherUser = await createTestUser('other-status');

    const createResponse = await createSignature(accessToken).expect(201);
    const signatureId = createResponse.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signatureId}/archive`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signatureId}/archive`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const restored = await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signatureId}/restore`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(restored.body.status).toBe('ACTIVE');

    await prisma.signature.update({
      where: { id: signatureId },
      data: { status: 'REVOKED' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signatureId}/restore`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);
    expect(user.id).not.toBe(otherUser.user.id);
  });

  it('protects GET, PATCH, and DELETE by ownership and soft-deletes with an audit event', async () => {
    const { user, accessToken } = await createTestUser('crud-owner');
    const otherUser = await createTestUser('crud-other');
    const created = await createSignature(accessToken).expect(201);
    const signatureId = created.body.id;

    await request(app.getHttpServer())
      .get(`/api/v1/signatures/${signatureId}`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/signatures/${signatureId}`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .send({ name: 'Hijacked' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/signatures/${signatureId}`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/signatures/${signatureId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Updated name', category: 'BUSINESS' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/signatures/${signatureId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ userId: otherUser.user.id })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/v1/signatures/${signatureId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const signature = await prisma.signature.findFirst({ where: { id: signatureId, userId: user.id } });
    expect(signature?.status).toBe('ARCHIVED');
    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, signatureId, event: 'SIGNATURE_DELETED' },
    });
    expect(audit).not.toBeNull();
  });

  it('returns summary counts for the authenticated user', async () => {
    const { accessToken } = await createTestUser('summary');

    await createSignature(accessToken);
    const archived = await createSignature(accessToken, { name: 'Archived' }).expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/signatures/${archived.body.id}/archive`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const summary = await request(app.getHttpServer())
      .get('/api/v1/signatures/summary')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(summary.body.limit).toBe(25);
    expect(summary.body.total).toBe(2);
    expect(summary.body.active).toBe(1);
    expect(summary.body.archived).toBe(1);
    expect(summary.body.remaining).toBe(25 - summary.body.total);
  });
});
