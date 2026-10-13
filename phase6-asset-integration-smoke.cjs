const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const sharp = require('sharp');
const { NestFactory } = require('@nestjs/core');

process.chdir(__dirname);
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { AppModule } = require('./dist/app.module.js');
const { PrismaService } = require('./dist/prisma/prisma.service.js');
const { StorageService } = require('./dist/storage/storage.service.js');
const { SignatureAssetsService } = require('./dist/signatures/signature-assets.service.js');

async function main() {
  let app;
  let userId;
  let signatureId;
  let objectKey;
  let stage = 'start';
  let objectClean = true;
  let rowsClean = true;

  try {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    const prisma = app.get(PrismaService);
    const storage = app.get(StorageService);
    const assets = app.get(SignatureAssetsService);
    const suffix = randomUUID();

    stage = 'create-test-user';
    const user = await prisma.user.create({
      data: {
        email: `phase6-asset-${suffix}@example.invalid`,
        passwordHash: 'phase6-test-only',
        firstName: 'Phase',
        lastName: 'Six',
        displayName: 'Phase Six Test',
        emailVerified: true,
        accountStatus: 'ACTIVE',
      },
    });
    userId = user.id;

    stage = 'create-test-signature';
    const signature = await prisma.signature.create({
      data: {
        userId,
        name: 'Phase 6 isolated asset test',
        category: 'CUSTOM',
        status: 'ACTIVE',
      },
    });
    signatureId = signature.id;

    stage = 'create-test-version';
    const version = await prisma.signatureVersion.create({
      data: {
        signatureId,
        versionNumber: 1,
        displayText: 'Phase Six Test Signature',
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
      },
    });
    objectKey = `users/${userId}/signatures/${signatureId}/versions/${version.id}/signature.svg`;

    stage = 'render-svg';
    const render = await assets.render(userId, signatureId, version.id);
    assert.equal(render.mimeType, 'image/svg+xml');

    stage = 'verify-saved-metadata';
    const savedVersion = await prisma.signatureVersion.findUnique({ where: { id: version.id } });
    const canonical = await storage.getObject(objectKey);
    assert.ok(savedVersion.assetChecksum);
    assert.equal(savedVersion.assetMimeType, 'image/svg+xml');
    assert.equal(savedVersion.assetSize, canonical.body.byteLength);
    assert.equal(
      savedVersion.assetChecksum,
      createHash('sha256').update(canonical.body).digest('hex'),
    );
    assert.equal(canonical.checksum, savedVersion.assetChecksum);

    stage = 'verify-svg';
    assert.match(canonical.body.toString('utf8'), /^<svg[\s\S]*<\/svg>$/);
    const svgInfo = await sharp(canonical.body).metadata();
    assert.equal(svgInfo.format, 'svg');

    stage = 'retrieve-svg';
    const retrieved = await assets.getAsset(userId, signatureId, version.id);
    assert.equal(retrieved.mimeType, 'image/svg+xml');
    assert.equal(retrieved.checksum, savedVersion.assetChecksum);

    stage = 'export-svg';
    const svgExport = await assets.export(userId, signatureId, version.id, 'svg', 1);
    assert.equal(svgExport.mimeType, 'image/svg+xml');

    stage = 'export-png';
    const png = await assets.export(userId, signatureId, version.id, 'png', 3);
    assert.equal(png.mimeType, 'image/png');
    assert.deepEqual([...png.body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const pngInfo = await sharp(png.body).metadata();
    assert.equal(pngInfo.width, 3600);
    assert.equal(pngInfo.height, 900);
    assert.equal(pngInfo.hasAlpha, true);

    console.log(
      JSON.stringify({
        render: 'passed',
        svg: 'passed',
        metadataAndChecksum: 'passed',
        retrieval: 'passed',
        svgExport: 'passed',
        pngExport: 'passed',
        pngTransparency: 'passed',
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: 'failed',
        stage,
        errorType: error instanceof Error ? error.name : 'Error',
      }),
    );
    process.exitCode = 1;
  } finally {
    if (app) {
      const prisma = app.get(PrismaService);
      const storage = app.get(StorageService);

      if (objectKey) {
        try {
          await storage.deleteObject(objectKey);
        } catch {
          objectClean = false;
        }
      }

      if (signatureId) {
        try {
          await prisma.auditLog.deleteMany({ where: { signatureId } });
          await prisma.signature.update({
            where: { id: signatureId },
            data: { currentVersionId: null },
          });
          await prisma.signatureVersion.deleteMany({ where: { signatureId } });
          await prisma.signature.delete({ where: { id: signatureId } });
        } catch {
          rowsClean = false;
        }
      }

      if (userId) {
        try {
          await prisma.user.delete({ where: { id: userId } });
        } catch {
          rowsClean = false;
        }
      }

      if (!objectClean || !rowsClean) {
        console.error(JSON.stringify({ cleanup: 'incomplete', objectClean, rowsClean }));
        process.exitCode = 1;
      }
      await app.close();
    }
  }
}

main();