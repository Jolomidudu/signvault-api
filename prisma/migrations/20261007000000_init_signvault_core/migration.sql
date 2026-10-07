-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED', 'PENDING_VERIFICATION');
CREATE TYPE "SignatureCategory" AS ENUM ('PROFESSIONAL', 'PERSONAL', 'BUSINESS', 'INITIALS', 'CUSTOM');
CREATE TYPE "SignatureStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'ARCHIVED');
CREATE TYPE "SignatureUsageType" AS ENUM ('COPY', 'EXPORT', 'SHARE', 'CRYPTOGRAPHIC_SIGN');
CREATE TYPE "VerificationStatus" AS ENUM ('VALID', 'INVALID', 'REVOKED', 'EXPIRED', 'MODIFIED', 'UNKNOWN');
CREATE TYPE "AuditEvent" AS ENUM ('USER_CREATED', 'USER_LOGIN', 'SIGNATURE_CREATED', 'SIGNATURE_UPDATED', 'SIGNATURE_VERSION_CREATED', 'SIGNATURE_COPIED', 'SIGNATURE_EXPORTED', 'SIGNATURE_SHARED', 'SIGNATURE_REVOKED', 'SIGNATURE_VERIFIED');

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "User" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(320) NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "firstName" VARCHAR(100) NOT NULL,
  "lastName" VARCHAR(100) NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "avatarUrl" TEXT,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "accountStatus" "AccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Signature" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "category" "SignatureCategory" NOT NULL,
  "status" "SignatureStatus" NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signatureId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "style" VARCHAR(100) NOT NULL,
  "displayText" VARCHAR(500) NOT NULL,
  "assetKey" TEXT NOT NULL,
  "assetMimeType" VARCHAR(100),
  "assetSize" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignatureVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureUsage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signatureId" UUID NOT NULL,
  "signatureVersionId" UUID,
  "userId" UUID NOT NULL,
  "usageType" "SignatureUsageType" NOT NULL,
  "externalReference" TEXT,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignatureUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Revocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signatureId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Revocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationRecord" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signatureId" UUID NOT NULL,
  "signatureVersionId" UUID,
  "signatureUsageId" UUID,
  "verificationStatus" "VerificationStatus" NOT NULL,
  "documentHash" TEXT,
  "hashAlgorithm" VARCHAR(100),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID,
  "signatureId" UUID,
  "event" "AuditEvent" NOT NULL,
  "ipAddress" VARCHAR(45),
  "userAgent" TEXT,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Signature_userId_idx" ON "Signature"("userId");
CREATE INDEX "Signature_status_idx" ON "Signature"("status");
CREATE INDEX "Signature_category_idx" ON "Signature"("category");
CREATE INDEX "Signature_expiresAt_idx" ON "Signature"("expiresAt");
CREATE UNIQUE INDEX "SignatureVersion_signatureId_versionNumber_key" ON "SignatureVersion"("signatureId", "versionNumber");
CREATE INDEX "SignatureVersion_signatureId_idx" ON "SignatureVersion"("signatureId");
CREATE INDEX "SignatureVersion_createdAt_idx" ON "SignatureVersion"("createdAt");
CREATE INDEX "SignatureUsage_signatureId_idx" ON "SignatureUsage"("signatureId");
CREATE INDEX "SignatureUsage_signatureVersionId_idx" ON "SignatureUsage"("signatureVersionId");
CREATE INDEX "SignatureUsage_userId_idx" ON "SignatureUsage"("userId");
CREATE INDEX "SignatureUsage_usageType_idx" ON "SignatureUsage"("usageType");
CREATE INDEX "SignatureUsage_expiresAt_idx" ON "SignatureUsage"("expiresAt");
CREATE INDEX "Revocation_signatureId_idx" ON "Revocation"("signatureId");
CREATE INDEX "Revocation_userId_idx" ON "Revocation"("userId");
CREATE INDEX "Revocation_revokedAt_idx" ON "Revocation"("revokedAt");
CREATE INDEX "VerificationRecord_signatureId_idx" ON "VerificationRecord"("signatureId");
CREATE INDEX "VerificationRecord_signatureVersionId_idx" ON "VerificationRecord"("signatureVersionId");
CREATE INDEX "VerificationRecord_signatureUsageId_idx" ON "VerificationRecord"("signatureUsageId");
CREATE INDEX "VerificationRecord_verificationStatus_idx" ON "VerificationRecord"("verificationStatus");
CREATE INDEX "VerificationRecord_verifiedAt_idx" ON "VerificationRecord"("verifiedAt");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_signatureId_idx" ON "AuditLog"("signatureId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_event_idx" ON "AuditLog"("event");

ALTER TABLE "Signature" ADD CONSTRAINT "Signature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureVersion" ADD CONSTRAINT "SignatureVersion_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureUsage" ADD CONSTRAINT "SignatureUsage_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureUsage" ADD CONSTRAINT "SignatureUsage_signatureVersionId_fkey" FOREIGN KEY ("signatureVersionId") REFERENCES "SignatureVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureUsage" ADD CONSTRAINT "SignatureUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Revocation" ADD CONSTRAINT "Revocation_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Revocation" ADD CONSTRAINT "Revocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_signatureVersionId_fkey" FOREIGN KEY ("signatureVersionId") REFERENCES "SignatureVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_signatureUsageId_fkey" FOREIGN KEY ("signatureUsageId") REFERENCES "SignatureUsage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;
