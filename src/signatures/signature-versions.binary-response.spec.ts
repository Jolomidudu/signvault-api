import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import cors from 'cors';
import helmet from 'helmet';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SignatureAssetsService } from './signature-assets.service';
import { SignatureVersionsController } from './signature-versions.controller';
import { SignatureVersionsService } from './signature-versions.service';

const signatureId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const svgBytes = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><text>HTTP fixture</text></svg>',
);
const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

describe('SignatureVersionsController binary responses', () => {
  let app: INestApplication;
  const assetsService = {
    getAsset: jest.fn(async () => ({
      body: svgBytes,
      mimeType: 'image/svg+xml',
      size: svgBytes.byteLength,
      checksum: 'a'.repeat(64),
      filename: 'signature-1.svg',
    })),
    export: jest.fn(async (_userId: string, _signatureId: string, _versionId: string, format: string) =>
      format === 'png'
        ? {
            body: pngBytes,
            mimeType: 'image/png',
            size: pngBytes.byteLength,
            checksum: 'b'.repeat(64),
            filename: 'signature-1.png',
          }
        : {
            body: svgBytes,
            mimeType: 'image/svg+xml',
            size: svgBytes.byteLength,
            checksum: 'a'.repeat(64),
            filename: 'signature-1.svg',
          },
    ),
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [SignatureVersionsController],
      providers: [
        { provide: SignatureVersionsService, useValue: {} },
        { provide: SignatureAssetsService, useValue: assetsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: { id: string } } } }) => {
          context.switchToHttp().getRequest().user = { id: '11111111-1111-4111-8111-111111111111' };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(helmet());
    app.use(
      cors({
        origin: 'http://localhost:3002',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      }),
    );
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends actual SVG bytes over HTTP for the private asset and SVG export', async () => {
    const assetPath = `/api/v1/signatures/${signatureId}/versions/${versionId}/asset`;
    const exportPath = `/api/v1/signatures/${signatureId}/versions/${versionId}/export?format=svg&scale=1`;

    for (const path of [assetPath, exportPath]) {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Origin', 'http://localhost:3002')
        .set('Authorization', 'Bearer test-only');
      const bytes = response.body as Buffer;

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('image/svg+xml');
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3002');
      expect(Buffer.isBuffer(bytes)).toBe(true);
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(Number(response.headers['content-length'])).toBe(bytes.byteLength);
      expect(bytes.toString('utf8')).toMatch(/^<svg\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    }
  });

  it('sends PNG export bytes and content type over HTTP', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/signatures/${signatureId}/versions/${versionId}/export?format=png&scale=1`)
      .set('Authorization', 'Bearer test-only');
    const bytes = response.body as Buffer;

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes).toEqual(pngBytes);
    expect(Number(response.headers['content-length'])).toBe(bytes.byteLength);
  });
});