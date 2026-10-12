import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SignatureSvgRenderer } from './rendering/signature-svg.renderer';
import { SignatureAssetsService } from './signature-assets.service';

describe('SignatureAssetsService', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const signatureId = '22222222-2222-4222-8222-222222222222';
  const versionId = '33333333-3333-4333-8333-333333333333';
  let version: Record<string, unknown>;
  let prisma: Record<string, any>;
  let objects: Map<string, { body: Buffer; contentType: string; size: number; checksum: string }>;
  let storage: Record<string, jest.Mock>;
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
      signature: { findFirst: jest.fn().mockResolvedValue({ id: signatureId }) },
      signatureVersion: {
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          if (where.assetKey) {
            return version.assetKey === where.assetKey && version.assetChecksum === where.assetChecksum
              ? { id: versionId }
              : null;
          }
          return version;
        }),
        update: jest.fn().mockImplementation(async ({ data }) => {
          version = { ...version, ...data };
          return version;
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    storage = {
      objectExists: jest.fn(async (key: string) => {
        const object = objects.get(key);
        return object
          ? { contentType: object.contentType, size: object.size, checksum: object.checksum }
          : null;
      }),
      putObject: jest.fn(async ({ key, body, contentType, checksum }) => {
        objects.set(key, { body, contentType, size: body.byteLength, checksum });
      }),
      getObject: jest.fn(async (key: string) => objects.get(key) ?? null),
      deleteObject: jest.fn(async (key: string) => objects.delete(key)),
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

  it('exports a transparent PNG at a bounded scale and audits the export', async () => {
    await service.render(userId, signatureId, versionId);
    const png = await service.export(userId, signatureId, versionId, 'png', 2);

    expect(png.mimeType).toBe('image/png');
    expect(png.body.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ event: 'SIGNATURE_EXPORTED' }) }),
    );
  }, 15000);
});