ALTER TYPE "AuditEvent" ADD VALUE IF NOT EXISTS 'SIGNATURE_VERSION_DUPLICATED';
ALTER TYPE "AuditEvent" ADD VALUE IF NOT EXISTS 'SIGNATURE_VERSION_SELECTED';
ALTER TYPE "AuditEvent" ADD VALUE IF NOT EXISTS 'SIGNATURE_VERSION_ARCHIVED';

ALTER TABLE "SignatureVersion"
  ALTER COLUMN "assetKey" DROP NOT NULL,
  ADD COLUMN "design" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Signature"
  ADD COLUMN "currentVersionId" UUID;

CREATE UNIQUE INDEX "SignatureVersion_signatureId_id_key"
  ON "SignatureVersion"("signatureId", "id");

ALTER TABLE "Signature"
  ADD CONSTRAINT "Signature_currentVersion_fkey"
  FOREIGN KEY ("id", "currentVersionId")
  REFERENCES "SignatureVersion"("signatureId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;