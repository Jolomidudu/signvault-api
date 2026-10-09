import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Signature Vault API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const uniqueEmail = (suffix: string) => `vault-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  const registerUser = async (email: string) => {
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        firstName: 'Test',
        lastName: 'User',
      })
      .expect(201);

    return {
      user: registerResponse.body.user,
      accessToken: registerResponse.body.accessToken,
      refreshToken: registerResponse.body.refreshToken,
    };
  };

  const createSignature = async (token: string, payload: Record<string, unknown> = {}) =>
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests to the signatures collection', async () => {
    await request(app.getHttpServer()).get('/api/v1/signatures').expect(401);
  });

  it('creates a signature for the authenticated user and ignores spoofed userId', async () => {
    const email = uniqueEmail('create');
    const { accessToken } = await registerUser(email);

    const response = await createSignature(accessToken, { userId: 'not-allowed' }).expect(201);

    expect(response.body).toMatchObject({
      name: 'Professional',
      category: 'PROFESSIONAL',
      status: 'ACTIVE',
    });
    expect(response.body.userId).toBeUndefined();

    const signature = await prisma.signature.findFirst({ where: { id: response.body.id } });
    expect(signature).not.toBeNull();
    expect(signature?.userId).toBeTruthy();

    await prisma.signature.deleteMany({ where: { userId: signature!.userId } });
    await prisma.user.delete({ where: { email } });
  });

  it('lists only the authenticated user signatures and supports filtering and pagination', async () => {
    const email = uniqueEmail('list');
    const { accessToken } = await registerUser(email);

    await createSignature(accessToken, { name: 'Work Signature', category: 'PROFESSIONAL' });
    await createSignature(accessToken, { name: 'Personal Brand', category: 'PERSONAL' });

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/signatures?category=PROFESSIONAL&limit=1&page=1')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(listResponse.body.items).toHaveLength(1);
    expect(listResponse.body.page).toBe(1);
    expect(listResponse.body.limit).toBe(1);
    expect(listResponse.body.items[0].category).toBe('PROFESSIONAL');

    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.signature.deleteMany({ where: { userId: user!.id } });
    await prisma.user.delete({ where: { id: user!.id } });
  });

  it('enforces the 25-signature vault limit', async () => {
    const email = uniqueEmail('limit');
    const { accessToken } = await registerUser(email);

    for (let i = 0; i < 25; i += 1) {
      await createSignature(accessToken, { name: `Signature ${i + 1}` });
    }

    const response = await createSignature(accessToken, { name: 'Signature 26' }).expect(409);
    expect(response.body.message).toMatch(/limit|maximum/i);

    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.signature.deleteMany({ where: { userId: user!.id } });
    await prisma.user.delete({ where: { id: user!.id } });
  });

  it('allows archive and restore operations for the owner, and rejects revoked restore', async () => {
    const email = uniqueEmail('status');
    const { accessToken } = await registerUser(email);

    const createResponse = await createSignature(accessToken).expect(201);
    const signatureId = createResponse.body.id;

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

    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.signature.deleteMany({ where: { userId: user!.id } });
    await prisma.user.delete({ where: { id: user!.id } });
  });

  it('returns summary counts for the authenticated user', async () => {
    const email = uniqueEmail('summary');
    const { accessToken } = await registerUser(email);

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
    expect(summary.body.total).toBeGreaterThanOrEqual(2);
    expect(summary.body.remaining).toBe(25 - summary.body.total);

    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.signature.deleteMany({ where: { userId: user!.id } });
    await prisma.user.delete({ where: { id: user!.id } });
  });
});
