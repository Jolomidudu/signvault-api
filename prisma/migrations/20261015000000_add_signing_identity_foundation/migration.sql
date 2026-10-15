CREATE TYPE "SigningIdentityStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "SigningKeyStatus" AS ENUM ('PENDING', 'ACTIVE', 'ROTATED', 'REVOKED', 'COMPROMISED', 'DISABLED');
CREATE TYPE "SigningProvider" AS ENUM ('AWS_KMS');
CREATE TYPE "SigningPublicKeyFormat" AS ENUM ('SPKI_DER');
CREATE TYPE "SigningKeyEventType" AS ENUM (
  'IDENTITY_CREATED',
  'IDENTITY_SUSPENDED',
  'IDENTITY_REACTIVATED',
  'IDENTITY_CLOSED',
  'KEY_PROVISIONING_REQUESTED',
  'KEY_PROVISIONED',
  'KEY_ACTIVATED',
  'KEY_ROTATED',
  'KEY_ROTATED_OUT',
  'KEY_REVOKED',
  'KEY_COMPROMISED',
  'KEY_DISABLED',
  'KEY_PROVISIONING_FAILED',
  'KEY_OPERATION_REQUESTED',
  'KEY_OPERATION_COMPLETED',
  'KEY_OPERATION_FAILED',
  'KEY_OPERATION_REQUIRES_RECONCILIATION'
);
CREATE TYPE "SigningActorType" AS ENUM ('USER', 'SYSTEM', 'ADMIN');
CREATE TYPE "SigningKeyOperationType" AS ENUM ('PROVISION_KEY', 'DISABLE_KEY', 'RECONCILE_KEY');
CREATE TYPE "SigningKeyOperationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'REQUIRES_RECONCILIATION');

CREATE TABLE "SigningIdentity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "status" "SigningIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "SigningIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SigningIdentity_closedAt_status_check" CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL))
);

CREATE TABLE "SigningKey" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signingIdentityId" UUID NOT NULL,
  "keyVersion" INTEGER NOT NULL,
  "algorithmProfile" VARCHAR(100) NOT NULL,
  "provider" "SigningProvider" NOT NULL,
  "providerKeyReference" VARCHAR(512) NOT NULL,
  "publicKey" BYTEA NOT NULL,
  "publicKeyFormat" "SigningPublicKeyFormat" NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "status" "SigningKeyStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "rotatedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "compromisedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SigningKey_keyVersion_positive_check" CHECK ("keyVersion" > 0),
  CONSTRAINT "SigningKey_algorithmProfile_nonempty_check" CHECK (length(btrim("algorithmProfile")) > 0),
  CONSTRAINT "SigningKey_providerKeyReference_nonempty_check" CHECK (length(btrim("providerKeyReference")) > 0),
  CONSTRAINT "SigningKey_publicKey_nonempty_check" CHECK (octet_length("publicKey") > 0),
  CONSTRAINT "SigningKey_fingerprint_format_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SigningKey_active_timestamp_check" CHECK ("status" <> 'ACTIVE' OR "activatedAt" IS NOT NULL),
  CONSTRAINT "SigningKey_rotated_timestamp_check" CHECK ("status" <> 'ROTATED' OR "rotatedAt" IS NOT NULL),
  CONSTRAINT "SigningKey_revoked_timestamp_check" CHECK ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL),
  CONSTRAINT "SigningKey_compromised_timestamp_check" CHECK ("status" <> 'COMPROMISED' OR "compromisedAt" IS NOT NULL),
  CONSTRAINT "SigningKey_disabled_timestamp_check" CHECK ("status" <> 'DISABLED' OR "disabledAt" IS NOT NULL)
);

CREATE TABLE "SigningKeyEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signingIdentityId" UUID NOT NULL,
  "signingKeyId" UUID,
  "eventType" "SigningKeyEventType" NOT NULL,
  "actorType" "SigningActorType" NOT NULL,
  "actorUserId" UUID,
  "correlationId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SigningKeyEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SigningKeyOperation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signingIdentityId" UUID NOT NULL,
  "signingKeyId" UUID,
  "operationType" "SigningKeyOperationType" NOT NULL,
  "status" "SigningKeyOperationStatus" NOT NULL DEFAULT 'PENDING',
  "correlationId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "safeErrorCode" VARCHAR(100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "SigningKeyOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SigningKeyOperation_attemptCount_nonnegative_check" CHECK ("attemptCount" >= 0)
);

CREATE UNIQUE INDEX "SigningIdentity_userId_key" ON "SigningIdentity"("userId");
CREATE INDEX "SigningIdentity_status_idx" ON "SigningIdentity"("status");

CREATE UNIQUE INDEX "SigningKey_signingIdentityId_keyVersion_key" ON "SigningKey"("signingIdentityId", "keyVersion");
CREATE UNIQUE INDEX "SigningKey_signingIdentityId_id_key" ON "SigningKey"("signingIdentityId", "id");
CREATE UNIQUE INDEX "SigningKey_provider_providerKeyReference_key" ON "SigningKey"("provider", "providerKeyReference");
CREATE UNIQUE INDEX "SigningKey_fingerprint_key" ON "SigningKey"("fingerprint");
CREATE UNIQUE INDEX "SigningKey_one_active_per_identity_key" ON "SigningKey"("signingIdentityId") WHERE "status" = 'ACTIVE';
CREATE INDEX "SigningKey_signingIdentityId_status_idx" ON "SigningKey"("signingIdentityId", "status");
CREATE INDEX "SigningKey_createdAt_idx" ON "SigningKey"("createdAt");

CREATE INDEX "SigningKeyEvent_signingIdentityId_createdAt_idx" ON "SigningKeyEvent"("signingIdentityId", "createdAt");
CREATE INDEX "SigningKeyEvent_signingKeyId_createdAt_idx" ON "SigningKeyEvent"("signingKeyId", "createdAt");
CREATE INDEX "SigningKeyEvent_actorUserId_idx" ON "SigningKeyEvent"("actorUserId");
CREATE INDEX "SigningKeyEvent_correlationId_idx" ON "SigningKeyEvent"("correlationId");

CREATE UNIQUE INDEX "SigningKeyOperation_correlationId_key" ON "SigningKeyOperation"("correlationId");
CREATE INDEX "SigningKeyOperation_signingIdentityId_status_idx" ON "SigningKeyOperation"("signingIdentityId", "status");
CREATE INDEX "SigningKeyOperation_status_createdAt_idx" ON "SigningKeyOperation"("status", "createdAt");

ALTER TABLE "SigningIdentity"
  ADD CONSTRAINT "SigningIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SigningKey"
  ADD CONSTRAINT "SigningKey_signingIdentityId_fkey"
  FOREIGN KEY ("signingIdentityId") REFERENCES "SigningIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SigningKeyEvent"
  ADD CONSTRAINT "SigningKeyEvent_signingIdentityId_fkey"
  FOREIGN KEY ("signingIdentityId") REFERENCES "SigningIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SigningKeyEvent_signingIdentityId_signingKeyId_fkey"
  FOREIGN KEY ("signingIdentityId", "signingKeyId") REFERENCES "SigningKey"("signingIdentityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SigningKeyEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SigningKeyOperation"
  ADD CONSTRAINT "SigningKeyOperation_signingIdentityId_fkey"
  FOREIGN KEY ("signingIdentityId") REFERENCES "SigningIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SigningKeyOperation_signingIdentityId_signingKeyId_fkey"
  FOREIGN KEY ("signingIdentityId", "signingKeyId") REFERENCES "SigningKey"("signingIdentityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;