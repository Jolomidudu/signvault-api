import { createHash } from 'node:crypto';
import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SignatureVersion } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SignatureSvgRenderer } from './rendering/signature-svg.renderer';

const SVG_MIME_TYPE = 'image/svg+xml';
const PNG_MIME_TYPE = 'image/png';
const MAX_SVG_SIZE = 64 * 1024;
const MAX_PNG_SIZE = 5 * 1024 * 1024;

type AssetVersion = Pick<
  SignatureVersion,
  | 'id'
  | 'signatureId'
  | 'versionNumber'
  | 'displayText'
  | 'style'
  | 'design'
  | 'assetKey'
  | 'assetMimeType'
  | 'assetSize'
  | 'assetChecksum'
>;

@Injectable()
export class SignatureAssetsService {
  private readonly logger = new Logger(SignatureAssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly renderer: SignatureSvgRenderer,
  ) {}

  private notFound(code: 'SIGNATURE_NOT_FOUND' | 'SIGNATURE_VERSION_NOT_FOUND' | 'SIGNATURE_ASSET_NOT_FOUND') {
    const messages = {
      SIGNATURE_NOT_FOUND: 'Signature not found.',
      SIGNATURE_VERSION_NOT_FOUND: 'Signature version not found.',
      SIGNATURE_ASSET_NOT_FOUND: 'Signature asset not found.',
    };
    return new NotFoundException({ message: messages[code], code });
  }

  private renderFailed() {
    return new InternalServerErrorException({
      message: 'Signature asset could not be rendered.',
      code: 'SIGNATURE_ASSET_RENDER_FAILED',
    });
  }

  private objectKey(userId: string, signatureId: string, versionId: string) {
    return `users/${userId}/signatures/${signatureId}/versions/${versionId}/signature.svg`;
  }

  private async requireOwnedVersion(userId: string, signatureId: string, versionId: string) {
    const signature = await this.prisma.signature.findFirst({
      where: { id: signatureId, userId },
      select: { id: true },
    });
    if (!signature) throw this.notFound('SIGNATURE_NOT_FOUND');

    const version = await this.prisma.signatureVersion.findFirst({
      where: { id: versionId, signatureId },
    });
    if (!version) throw this.notFound('SIGNATURE_VERSION_NOT_FOUND');
    return version;
  }

  private async recordAudit(
    userId: string,
    signatureId: string,
    event: 'SIGNATURE_ASSET_RENDERED' | 'SIGNATURE_EXPORTED',
    metadata: Record<string, unknown>,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: { userId, signatureId, event, metadata: metadata as Prisma.InputJsonValue },
      });
    } catch {
      this.logger.warn('Signature asset audit event could not be recorded.');
    }
  }

  async render(userId: string, signatureId: string, versionId: string) {
    const version = await this.requireOwnedVersion(userId, signatureId, versionId);
    let svg: Buffer;
    try {
      svg = this.renderer.render(version);
    } catch {
      throw this.renderFailed();
    }
    if (svg.byteLength > MAX_SVG_SIZE) throw this.renderFailed();

    const key = this.objectKey(userId, signatureId, versionId);
    const checksum = createHash('sha256').update(svg).digest('hex');
    const previousInfo = await this.storage.objectExists(key);
    const alreadyStored =
      previousInfo?.checksum === checksum &&
      previousInfo.contentType === SVG_MIME_TYPE &&
      previousInfo.size === svg.byteLength;

    if (!alreadyStored) {
      const previousObject = previousInfo ? await this.storage.getObject(key) : null;
      await this.storage.putObject({ key, body: svg, contentType: SVG_MIME_TYPE, checksum });
      try {
        await this.prisma.signatureVersion.update({
          where: { id: version.id },
          data: {
            assetKey: key,
            assetMimeType: SVG_MIME_TYPE,
            assetSize: svg.byteLength,
            assetChecksum: checksum,
          },
        });
      } catch {
        try {
          if (previousObject) {
            await this.storage.putObject({
              key,
              body: previousObject.body,
              contentType: previousObject.contentType ?? SVG_MIME_TYPE,
              checksum: previousObject.checksum ?? createHash('sha256').update(previousObject.body).digest('hex'),
            });
          } else {
            await this.storage.deleteObject(key);
          }
        } catch {
          this.logger.error('Signature asset metadata compensation failed.');
        }
        throw this.renderFailed();
      }
    } else if (
      version.assetKey !== key ||
      version.assetMimeType !== SVG_MIME_TYPE ||
      version.assetSize !== svg.byteLength ||
      version.assetChecksum !== checksum
    ) {
      await this.prisma.signatureVersion.update({
        where: { id: version.id },
        data: {
          assetKey: key,
          assetMimeType: SVG_MIME_TYPE,
          assetSize: svg.byteLength,
          assetChecksum: checksum,
        },
      });
    }

    await this.recordAudit(userId, signatureId, 'SIGNATURE_ASSET_RENDERED', {
      versionId,
      format: 'svg',
      size: svg.byteLength,
      reused: alreadyStored,
    });

    return { versionId, mimeType: SVG_MIME_TYPE, size: svg.byteLength, checksum, reused: alreadyStored };
  }

  private async getCanonicalAsset(userId: string, signatureId: string, versionId: string) {
    const version = await this.requireOwnedVersion(userId, signatureId, versionId);
    const expectedKey = this.objectKey(userId, signatureId, versionId);
    if (
      version.assetKey !== expectedKey ||
      version.assetMimeType !== SVG_MIME_TYPE ||
      !version.assetChecksum ||
      !version.assetSize
    ) {
      throw this.notFound('SIGNATURE_ASSET_NOT_FOUND');
    }

    const object = await this.storage.getObject(expectedKey);
    if (!object) throw this.notFound('SIGNATURE_ASSET_NOT_FOUND');
    const checksum = createHash('sha256').update(object.body).digest('hex');
    if (
      object.contentType !== SVG_MIME_TYPE ||
      object.size !== version.assetSize ||
      object.checksum !== version.assetChecksum ||
      checksum !== version.assetChecksum
    ) {
      throw this.renderFailed();
    }
    return { version, body: object.body, checksum };
  }

  async getAsset(userId: string, signatureId: string, versionId: string) {
    const asset = await this.getCanonicalAsset(userId, signatureId, versionId);
    await this.recordAudit(userId, signatureId, 'SIGNATURE_EXPORTED', {
      versionId,
      format: 'svg',
      size: asset.body.byteLength,
    });
    return {
      body: asset.body,
      mimeType: SVG_MIME_TYPE,
      size: asset.body.byteLength,
      checksum: asset.checksum,
      filename: `signature-${asset.version.versionNumber}.svg`,
    };
  }

  async export(
    userId: string,
    signatureId: string,
    versionId: string,
    format: 'svg' | 'png',
    scale: number,
  ) {
    const asset = await this.getCanonicalAsset(userId, signatureId, versionId);
    let body = asset.body;
    let mimeType = SVG_MIME_TYPE;
    let checksum = asset.checksum;

    if (format === 'png') {
      try {
        body = await sharp(asset.body, { limitInputPixels: 1200 * 300 })
          .resize({ width: 1200 * scale, height: 300 * scale, fit: 'fill' })
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch {
        throw this.renderFailed();
      }
      if (body.byteLength > MAX_PNG_SIZE) throw this.renderFailed();
      mimeType = PNG_MIME_TYPE;
      checksum = createHash('sha256').update(body).digest('hex');
    }

    await this.recordAudit(userId, signatureId, 'SIGNATURE_EXPORTED', {
      versionId,
      format,
      size: body.byteLength,
    });

    return {
      body,
      mimeType,
      size: body.byteLength,
      checksum,
      filename: `signature-${asset.version.versionNumber}.${format}`,
    };
  }
}