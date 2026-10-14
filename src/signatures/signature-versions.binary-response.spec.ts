import { createHash } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import cors from 'cors';
import helmet from 'helmet';
import request from 'supertest';
import sharp from 'sharp';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SignatureAssetsService } from './signature-assets.service';
import { rasterizeSignatureSvg } from './signature-png.rasterizer';
import { SignatureSvgRenderer } from './rendering/signature-svg.renderer';
import { SignatureVersionsController } from './signature-versions.controller';
import { SignatureVersionsService } from './signature-versions.service';

const signatureId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const svgBytes = new SignatureSvgRenderer().render({
  displayText: 'Jolosticks',
  style: 'ELEGANT',
  design: {
    fontFamily: 'script',
    fontSize: 48,
    fontWeight: 400,
    letterSpacing: 0,
    slant: 0,
    rotation: 0,
    strokeWidth: 1,
  },
});
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const scriptPixelHashes = [
  'a45f1aab9596bd4cf2d116b4e980d65ba968a3de9b89e9e123df48ce444abf7f',
  '7773de805bcda7f1bb6b14ef3e71e422c3bcb459a88ea2543b9e3387600d43c3',
  '004b501c467787cae2a393bff09662cd047482c0e5cd00fa498f67eb3c0c9778',
];

describe('SignatureVersionsController binary responses', () => {
  let app: INestApplication;
  const pngByScale = new Map<number, Buffer>();
  const assetsService = {
    getAsset: jest.fn(async () => ({
      body: svgBytes,
      mimeType: 'image/svg+xml',
      size: svgBytes.byteLength,
      checksum: 'a'.repeat(64),
      filename: 'signature-1.svg',
    })),
    export: jest.fn(async (_userId: string, _signatureId: string, _versionId: string, format: string, scale: number) =>
      format === 'png'
        ? {
            body: pngByScale.get(scale)!,
            mimeType: 'image/png',
            size: pngByScale.get(scale)!.byteLength,
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
    for (const scale of [1, 2, 3]) {
      pngByScale.set(
        scale,
        rasterizeSignatureSvg(svgBytes, scale),
      );
    }

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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
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

  it('sends valid PNG bytes and scale-specific headers over HTTP at 1x, 2x, and 3x', async () => {
    for (const scale of [1, 2, 3]) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/signatures/${signatureId}/versions/${versionId}/export?format=png&scale=${scale}`)
        .set('Authorization', 'Bearer test-only');
      const bytes = response.body as Buffer;
      const metadata = await sharp(bytes).metadata();

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
      expect(response.headers['content-disposition']).toBe('attachment; filename="signature-1.png"');
      expect(Buffer.isBuffer(bytes)).toBe(true);
      expect(bytes.subarray(0, 8)).toEqual(pngSignature);
      expect(bytes.byteLength).toBeGreaterThan(100);
      expect(Number(response.headers['content-length'])).toBe(bytes.byteLength);
      expect(metadata).toMatchObject({ format: 'png', width: 1200 * scale, height: 300 * scale });
      const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
      expect(createHash('sha256').update(pixels).digest('hex')).toBe(scriptPixelHashes[scale - 1]);
    }
  });
});