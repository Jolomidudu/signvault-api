import { createHash } from 'node:crypto';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { Mock } from 'jest-mock';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PutObjectInput, StoredObject, StoredObjectInfo } from '../storage/storage.types';
import { SignatureSvgRenderer } from './rendering/signature-svg.renderer';
import { SignatureAssetsService } from './signature-assets.service';

describe('SignatureAssetsService', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const signatureId = '22222222-2222-4222-8222-222222222222';
  const versionId = '33333333-3333-4333-8333-333333333333';
  let version: Record<string, unknown>;
  let prisma: {
    signature: { findFirst: Mock<() => Promise<{ id: string } | null>> };
    signatureVersion: {
      findFirst: Mock<(args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>>;
      update: Mock<(args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>>;
    };
    auditLog: { create: Mock<(args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>> };
  };
  let objects: Map<string, StoredObject & { contentType: string; size: number }>;
  let storage: {
    objectExists: Mock<(key: string) => Promise<StoredObjectInfo | null>>;
    putObject: Mock<(input: PutObjectInput) => Promise<void>>;
    getObject: Mock<(key: string) => Promise<StoredObject | null>>;
    deleteObject: Mock<(key: string) => Promise<boolean>>;
  };
  let service: SignatureAssetsService;

  beforeEach(() => {
    version = {
      id: versionId,
      signatureId,
      versionNumber: 1,
      displayText: 'Saved Name',
      style: 'CLASSIC',
      design: {
        fontFamily: 'serif',
        fontSize: 48,
        fontWeight: 400,
        letterSpacing: 0,
        slant: 0,
        rotation: 0,
        strokeWidth: 1,
      },
      assetKey: null,
      assetMimeType: null,
      assetSize: null,
      assetChecksum: null,
    };
    objects = new Map();
    prisma = {
      signature: {
        findFirst: jest.fn<() => Promise<{ id: string } | null>>().mockResolvedValue({ id: signatureId }),
      },
      signatureVersion: {
        findFirst: jest
          .fn<(args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>>()
          .mockImplementation(async ({ where }) => {
          if (where.assetKey) {
            return version.assetKey === where.assetKey && version.assetChecksum === where.assetChecksum
              ? { id: versionId }
              : null;
          }
          return version;
          }),
        update: jest
          .fn<(args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>>()
          .mockImplementation(async ({ data }) => {
          version = { ...version, ...data };
          return version;
          }),
      },
      auditLog: {
        create: jest
          .fn<(args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>>()
          .mockResolvedValue({}),
      },
    };
    storage = {
      objectExists: jest.fn<(key: string) => Promise<StoredObjectInfo | null>>(async (key) => {
        const object = objects.get(key);
        return object
          ? { contentType: object.contentType, size: object.size, checksum: object.checksum }
          : null;
      }),
      putObject: jest.fn<(input: PutObjectInput) => Promise<void>>(async ({ key, body, contentType, checksum }) => {
        objects.set(key, { body, contentType, size: body.byteLength, checksum });
      }),
      getObject: jest.fn<(key: string) => Promise<StoredObject | null>>(async (key) => objects.get(key) ?? null),
      deleteObject: jest.fn<(key: string) => Promise<boolean>>(async (key) => objects.delete(key)),
    };
    service = new SignatureAssetsService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      new SignatureSvgRenderer(),
    );
  });

  it('renders saved designer data and reuses an identical immutable asset', async () => {
    const first = await service.render(userId, signatureId, versionId);
    const second = await service.render(userId, signatureId, versionId);

    expect(first.reused).toBe(false);
    expect(second).toMatchObject({ versionId, mimeType: 'image/svg+xml', reused: true });
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(objects.values().next().value?.body.toString()).toContain('Saved Name');
    expect(prisma.signatureVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assetMimeType: 'image/svg+xml', assetChecksum: expect.any(String) }),
      }),
    );

    const asset = await service.getAsset(userId, signatureId, versionId);
    expect(asset.mimeType).toBe('image/svg+xml');
    expect(asset.body.byteLength).toBeGreaterThan(0);
    expect(asset.body.toString('utf8')).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(asset.body.toString('utf8')).toContain('Saved Name');
  });

  it('does not read private storage when the signature is not owned', async () => {
    await service.render(userId, signatureId, versionId);
    prisma.signature.findFirst.mockResolvedValue(null);

    await expect(service.getAsset(userId, signatureId, versionId)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('does not access storage when the parent signature is not owned', async () => {
    prisma.signature.findFirst.mockResolvedValue(null);

    await expect(service.render(userId, signatureId, versionId)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.objectExists).not.toHaveBeenCalled();
  });

  it('compensates an uploaded object if metadata persistence fails', async () => {
    prisma.signatureVersion.update.mockRejectedValue(new Error('database details'));

    await expect(service.render(userId, signatureId, versionId)).rejects.toMatchObject({
      response: { code: 'SIGNATURE_ASSET_RENDER_FAILED' },
    });
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(objects.size).toBe(0);
  });

  it('translates missing private objects and storage failures safely', async () => {
    await service.render(userId, signatureId, versionId);
    storage.getObject.mockResolvedValueOnce(null);
    await expect(service.getAsset(userId, signatureId, versionId)).rejects.toMatchObject({
      response: { code: 'SIGNATURE_ASSET_NOT_FOUND' },
    });

    storage.objectExists.mockRejectedValueOnce(
      new ServiceUnavailableException({ message: 'Signature asset storage is unavailable.' }),
    );
    await expect(service.render(userId, signatureId, versionId)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('exports valid transparent PNGs at each supported scale and audits each export', async () => {
    await service.render(userId, signatureId, versionId);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    for (const scale of [1, 2, 3]) {
      const png = await service.export(userId, signatureId, versionId, 'png', scale);
      const metadata = await sharp(png.body).metadata();

      expect(png.mimeType).toBe('image/png');
      expect(png.body.subarray(0, 8)).toEqual(pngSignature);
      expect(png.body.byteLength).toBeGreaterThan(100);
      expect(metadata).toMatchObject({ format: 'png', width: 1200 * scale, height: 300 * scale });
    }

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ event: 'SIGNATURE_EXPORTED' }) }),
    );
  }, 15000);

  it('rasterizes recognizable signature text with stable pixels at each scale', async () => {
    version = {
      ...version,
      displayText: 'Jolosticks',
      style: 'ELEGANT',
      design: { ...(version.design as Record<string, unknown>), fontFamily: 'script' },
    };
    await service.render(userId, signatureId, versionId);

    const pixelHashes: string[] = [];
    for (const scale of [1, 2, 3]) {
      const png = await service.export(userId, signatureId, versionId, 'png', scale);
      const pixels = await sharp(png.body).ensureAlpha().raw().toBuffer();
      pixelHashes.push(createHash('sha256').update(pixels).digest('hex'));
    }

    expect(pixelHashes).toEqual([
      'a45f1aab9596bd4cf2d116b4e980d65ba968a3de9b89e9e123df48ce444abf7f',
      '7773de805bcda7f1bb6b14ef3e71e422c3bcb459a88ea2543b9e3387600d43c3',
      '004b501c467787cae2a393bff09662cd047482c0e5cd00fa498f67eb3c0c9778',
    ]);
  }, 15000);

  it('resolves every supported font family from bundled files', async () => {
    const fontCases = [
      { fontFamily: 'serif', style: 'CLASSIC', pixelHash: '6655d7a63f8238cf71391b37cca6843d8dfc18e45fd7ba9d3cf2edbebaec593c' },
      { fontFamily: 'script', style: 'ELEGANT', pixelHash: 'a45f1aab9596bd4cf2d116b4e980d65ba968a3de9b89e9e123df48ce444abf7f' },
      { fontFamily: 'modern-script', style: 'MODERN', pixelHash: 'a45f1aab9596bd4cf2d116b4e980d65ba968a3de9b89e9e123df48ce444abf7f' },
      { fontFamily: 'sans-serif', style: 'MINIMAL', pixelHash: '6408b17cb40665d7bc77eb83cfad7edc46a9e46be90bcf030bb177b57168eb0e' },
    ];
    const pixelHashes: string[] = [];

    for (const fontCase of fontCases) {
      version = {
        ...version,
        displayText: 'Jolosticks',
        style: fontCase.style,
        design: { ...(version.design as Record<string, unknown>), fontFamily: fontCase.fontFamily },
      };
      await service.render(userId, signatureId, versionId);
      const png = await service.export(userId, signatureId, versionId, 'png', 1);
      const pixels = await sharp(png.body).ensureAlpha().raw().toBuffer();
      pixelHashes.push(createHash('sha256').update(pixels).digest('hex'));
    }

    expect(pixelHashes).toEqual(fontCases.map(({ pixelHash }) => pixelHash));
  }, 15000);
});