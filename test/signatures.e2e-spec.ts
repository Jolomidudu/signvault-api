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
      const signatures = await prisma.signature.findMany({
        where: { userId },
        select: { id: true },
      });
      const signatureIds = signatures.map((signature) => signature.id);
      await prisma.signature.updateMany({
        where: { id: { in: signatureIds } },
        data: { currentVersionId: null },
      });
      await prisma.signatureVersion.deleteMany({ where: { signatureId: { in: signatureIds } } });
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

  it('creates, lists, and retrieves owned versions with validated designer data', async () => {
    const { accessToken } = await createTestUser('versions-owner');
    const otherUser = await createTestUser('versions-other');
    const signature = await createSignature(accessToken).expect(201);
    const payload = {
      displayText: 'Jolomi Dudu',
      style: 'CLASSIC',
      design: {
        fontFamily: 'serif',
        fontSize: 48,
        fontWeight: 400,
        letterSpacing: 0,
        slant: -8,
        rotation: 0,
        strokeWidth: 2,
      },
    };

    await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signature.body.id}/versions`)
      .send(payload)
      .expect(401);

    const created = await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signature.body.id}/versions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(payload)
      .expect(201);

    expect(created.body).toMatchObject({
      signatureId: signature.body.id,
      versionNumber: 1,
      displayText: 'Jolomi Dudu',
      style: 'CLASSIC',
      isCurrent: true,
      design: payload.design,
    });
    expect(created.body.assetKey).toBeUndefined();

    await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signature.body.id}/versions`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .send(payload)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signature.body.id}/versions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...payload, design: { ...payload.design, scriptUrl: 'https://fonts.example/font' } })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signature.body.id}/versions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...payload, design: { ...payload.design, fontSize: 1000000 } })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signature.body.id}/versions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...payload, design: { ...payload.design, fontFamily: 'https://evil.example/font' } })
      .expect(400);

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/signatures/${signature.body.id}/versions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].id).toBe(created.body.id);

    await request(app.getHttpServer())
      .get(`/api/v1/signatures/${signature.body.id}/versions`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/signatures/${signature.body.id}/versions/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/signatures/${signature.body.id}/versions/${created.body.id}`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .expect(404);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/signatures/${signature.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(detail.body.versionCount).toBe(1);
    expect(detail.body.currentVersion.id).toBe(created.body.id);
  });

  it('assigns unique versions under concurrent creation requests', async () => {
    const { user, accessToken } = await createTestUser('versions-concurrent');
    const signature = await createSignature(accessToken).expect(201);
    const payload = {
      displayText: 'Concurrent Signature',
      style: 'MODERN',
      design: {
        fontFamily: 'sans-serif',
        fontSize: 32,
        fontWeight: 500,
        letterSpacing: 1,
        slant: 0,
        rotation: 0,
        strokeWidth: 1,
      },
    };

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/signatures/${signature.body.id}/versions`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send(payload),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 201, 201, 201, 201]);

    const versions = await prisma.signatureVersion.findMany({
      where: { signatureId: signature.body.id },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(user.id).toBeTruthy();
  });

  it('duplicates immutably, selects only same-signature versions, and archives without deletion', async () => {
    const { user, accessToken } = await createTestUser('versions-history');
    const otherUser = await createTestUser('versions-history-other');
    const signature = await createSignature(accessToken).expect(201);
    const unrelatedSignature = await createSignature(accessToken, { name: 'Personal' }).expect(201);
    const payload = {
      displayText: 'Historical Text',
      style: 'ELEGANT',
      design: {
        fontFamily: 'script',
        fontSize: 52,
        fontWeight: 400,
        letterSpacing: 0,
        slant: -10,
        rotation: 2,
        strokeWidth: 2,
      },
    };
    const first = await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signature.body.id}/versions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(payload)
      .expect(201);
    const unrelated = await request(app.getHttpServer())
      .post(`/api/v1/signatures/${unrelatedSignature.body.id}/versions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(payload)
      .expect(201);

    const duplicate = await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signature.body.id}/versions/${first.body.id}/duplicate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(duplicate.body.versionNumber).toBe(2);

    await request(app.getHttpServer())
      .put(`/api/v1/signatures/${signature.body.id}/versions/${unrelated.body.id}/current`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .put(`/api/v1/signatures/${signature.body.id}/versions/${duplicate.body.id}/current`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .expect(404);

    const selected = await request(app.getHttpServer())
      .put(`/api/v1/signatures/${signature.body.id}/versions/${duplicate.body.id}/current`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(selected.body.isCurrent).toBe(true);

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/signatures/${signature.body.id}/versions/${duplicate.body.id}/archive`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(archived.body.archivedAt).toBeTruthy();
    expect(archived.body.isCurrent).toBe(false);

    const remaining = await prisma.signatureVersion.findMany({ where: { signatureId: signature.body.id } });
    expect(remaining).toHaveLength(2);
    expect(remaining.find((version) => version.id === first.body.id)?.displayText).toBe('Historical Text');
    const storedSignature = await prisma.signature.findUnique({ where: { id: signature.body.id } });
    expect(storedSignature?.currentVersionId).toBeNull();
    expect(user.id).toBeTruthy();
  });
});
