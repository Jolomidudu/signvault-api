import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  SigningIdentityStatus,
  SigningKeyEventType,
  SigningKeyOperationType,
  SigningKeyStatus,
  SigningProvider,
  SigningPublicKeyFormat,
  SigningActorType,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_PUBLIC_KEY_BYTES = 16 * 1024;
const ALGORITHM_PROFILE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,99}$/;
type KeyTransitionTarget = Extract<SigningKeyStatus, 'REVOKED' | 'COMPROMISED' | 'DISABLED'>;
const PROFILE_KEY_TYPES: Record<string, string> = { ED25519_V1: 'ed25519' };

const ALLOWED_KEY_TRANSITIONS: Record<SigningKeyStatus, SigningKeyStatus[]> = {
  PENDING: ['ACTIVE', 'REVOKED', 'COMPROMISED', 'DISABLED'],
  ACTIVE: ['ROTATED', 'REVOKED', 'COMPROMISED', 'DISABLED'],
  ROTATED: ['REVOKED', 'COMPROMISED', 'DISABLED'],
  REVOKED: [],
  COMPROMISED: [],
  DISABLED: ['REVOKED', 'COMPROMISED'],
};

type Actor = {
  type: SigningActorType;
  userId?: string;
};

export type CreateSigningKeyMetadata = {
  algorithmProfile: string;
  provider: SigningProvider;
  providerKeyReference: string;
  publicKey: Buffer;
  publicKeyFormat: SigningPublicKeyFormat;
};

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

@Injectable()
export class SigningDomainService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireIdentity(transaction: Prisma.TransactionClient, userId: string) {
    const identity = await transaction.signingIdentity.findUnique({
      where: { userId },
      include: { user: { select: { accountStatus: true, emailVerified: true } } },
    });

    if (!identity) {
      throw new NotFoundException({
        message: 'Signing identity not found.',
        code: 'SIGNING_IDENTITY_NOT_FOUND',
      });
    }

    return identity;
  }

  private requireSigningAllowed(identity: Awaited<ReturnType<SigningDomainService['requireIdentity']>>) {
    if (
      identity.status !== SigningIdentityStatus.ACTIVE ||
      identity.user.accountStatus !== 'ACTIVE' ||
      !identity.user.emailVerified
    ) {
      throw new ForbiddenException({
        message: 'Signing identity is not eligible for key activation.',
        code: 'SIGNING_IDENTITY_NOT_ACTIVE',
      });
    }
  }

  private async lockIdentity(transaction: Prisma.TransactionClient, identityId: string) {
    await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${identityId}, 0))`;
  }

  private async createEvent(
    transaction: Prisma.TransactionClient,
    input: {
      signingIdentityId: string;
      signingKeyId?: string;
      eventType: SigningKeyEventType;
      actor: Actor;
      correlationId?: string;
      metadata?: Prisma.InputJsonObject;
    },
  ) {
    return transaction.signingKeyEvent.create({
      data: {
        signingIdentityId: input.signingIdentityId,
        signingKeyId: input.signingKeyId,
        eventType: input.eventType,
        actorType: input.actor.type,
        actorUserId: input.actor.userId ?? null,
        correlationId: input.correlationId ?? randomUUID(),
        metadata: input.metadata ?? {},
      },
    });
  }

  async createIdentity(userId: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.findUnique({
          where: { id: userId },
          select: { id: true, accountStatus: true, emailVerified: true },
        });
        if (!user || user.accountStatus !== 'ACTIVE' || !user.emailVerified) {
          throw new ForbiddenException({
            message: 'An active, verified account is required.',
            code: 'ACCOUNT_NOT_ACTIVE',
          });
        }

        const identity = await transaction.signingIdentity.create({ data: { userId } });
        await this.createEvent(transaction, {
          signingIdentityId: identity.id,
          eventType: SigningKeyEventType.IDENTITY_CREATED,
          actor: { type: SigningActorType.USER, userId },
        });
        return identity;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          message: 'A signing identity already exists for this user.',
          code: 'SIGNING_IDENTITY_ALREADY_EXISTS',
        });
      }
      throw error;
    }
  }

  async createPendingKey(userId: string, input: CreateSigningKeyMetadata) {
    const publicKey = this.validateKeyMetadata(input);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const identity = await this.requireIdentity(transaction, userId);
        this.requireSigningAllowed(identity);
        await this.lockIdentity(transaction, identity.id);

        const latestKey = await transaction.signingKey.findFirst({
          where: { signingIdentityId: identity.id },
          orderBy: { keyVersion: 'desc' },
          select: { keyVersion: true },
        });
        const keyVersion = (latestKey?.keyVersion ?? 0) + 1;
        const fingerprint = createHash('sha256').update(publicKey).digest('hex');
        const key = await transaction.signingKey.create({
          data: {
            signingIdentityId: identity.id,
            keyVersion,
            algorithmProfile: input.algorithmProfile,
            provider: input.provider,
            providerKeyReference: input.providerKeyReference.trim(),
            publicKey: Uint8Array.from(publicKey),
            publicKeyFormat: input.publicKeyFormat,
            fingerprint,
          },
        });
        await this.createEvent(transaction, {
          signingIdentityId: identity.id,
          signingKeyId: key.id,
          eventType: SigningKeyEventType.KEY_METADATA_RECORDED,
          actor: { type: SigningActorType.USER, userId },
          metadata: { keyVersion },
        });

        return key;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          message: 'Signing key metadata conflicts with an existing key.',
          code: 'SIGNING_KEY_METADATA_CONFLICT',
        });
      }
      throw error;
    }
  }

  private validateKeyMetadata(input: CreateSigningKeyMetadata) {
    if (!ALGORITHM_PROFILE_PATTERN.test(input.algorithmProfile)) {
      throw new UnprocessableEntityException({
        message: 'Invalid signing algorithm profile.',
        code: 'INVALID_SIGNING_ALGORITHM_PROFILE',
      });
    }
    if (!PROFILE_KEY_TYPES[input.algorithmProfile]) {
      throw new UnprocessableEntityException({
        message: 'Unsupported signing algorithm profile.',
        code: 'UNSUPPORTED_SIGNING_ALGORITHM_PROFILE',
      });
    }
    if (!input.providerKeyReference.trim() || input.providerKeyReference.length > 512) {
      throw new UnprocessableEntityException({
        message: 'Invalid provider key reference.',
        code: 'INVALID_PROVIDER_KEY_REFERENCE',
      });
    }
    if (
      !Buffer.isBuffer(input.publicKey) ||
      input.publicKey.byteLength === 0 ||
      input.publicKey.byteLength > MAX_PUBLIC_KEY_BYTES
    ) {
      throw new UnprocessableEntityException({
        message: 'Invalid public-key material.',
        code: 'INVALID_PUBLIC_KEY',
      });
    }
    if (input.publicKeyFormat !== SigningPublicKeyFormat.SPKI_DER) {
      throw new UnprocessableEntityException({
        message: 'Unsupported public-key format.',
        code: 'UNSUPPORTED_PUBLIC_KEY_FORMAT',
      });
    }

    try {
      const parsedPublicKey = createPublicKey({ key: input.publicKey, format: 'der', type: 'spki' });
      const canonicalPublicKey = parsedPublicKey.export({ format: 'der', type: 'spki' });
      if (
        !Buffer.isBuffer(canonicalPublicKey) ||
        !canonicalPublicKey.equals(input.publicKey) ||
        parsedPublicKey.asymmetricKeyType !== PROFILE_KEY_TYPES[input.algorithmProfile]
      ) {
        throw new Error('Non-canonical SPKI data');
      }
      return canonicalPublicKey;
    } catch {
      throw new UnprocessableEntityException({
        message: 'Public-key material is not canonical SPKI DER.',
        code: 'INVALID_PUBLIC_KEY_FORMAT',
      });
    }
  }

  async activateOrRotatePendingKey(userId: string, signingKeyId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const identity = await this.requireIdentity(transaction, userId);
      this.requireSigningAllowed(identity);
      await this.lockIdentity(transaction, identity.id);

      const pendingKey = await transaction.signingKey.findFirst({
        where: { id: signingKeyId, signingIdentityId: identity.id },
      });
      if (!pendingKey) {
        throw new NotFoundException({
          message: 'Pending signing key not found.',
          code: 'SIGNING_KEY_NOT_FOUND',
        });
      }
      if (pendingKey.status !== SigningKeyStatus.PENDING) {
        throw new ConflictException({
          message: 'Only pending signing keys can be activated.',
          code: 'SIGNING_KEY_NOT_PENDING',
        });
      }

      const activeKey = await transaction.signingKey.findFirst({
        where: { signingIdentityId: identity.id, status: SigningKeyStatus.ACTIVE },
      });
      const now = new Date();
      const correlationId = randomUUID();

      if (activeKey) {
        await transaction.signingKey.update({
          where: { id: activeKey.id },
          data: { status: SigningKeyStatus.ROTATED, rotatedAt: now },
        });
      }
      const activatedKey = await transaction.signingKey.update({
        where: { id: pendingKey.id },
        data: { status: SigningKeyStatus.ACTIVE, activatedAt: now },
      });

      if (activeKey) {
        await this.createEvent(transaction, {
          signingIdentityId: identity.id,
          signingKeyId: activeKey.id,
          eventType: SigningKeyEventType.KEY_ROTATED_OUT,
          actor: { type: SigningActorType.USER, userId },
          correlationId,
          metadata: { replacementKeyId: pendingKey.id, replacementKeyVersion: pendingKey.keyVersion },
        });
      }
      await this.createEvent(transaction, {
        signingIdentityId: identity.id,
        signingKeyId: activatedKey.id,
        eventType: activeKey ? SigningKeyEventType.KEY_ROTATED : SigningKeyEventType.KEY_ACTIVATED,
        actor: { type: SigningActorType.USER, userId },
        correlationId,
        metadata: activeKey
          ? { previousKeyId: activeKey.id, keyVersion: activatedKey.keyVersion }
          : { keyVersion: activatedKey.keyVersion },
      });

      return activatedKey;
    });
  }

  async revokeKey(userId: string, signingKeyId: string, actor: Actor = { type: SigningActorType.USER, userId }) {
    return this.transitionKey(userId, signingKeyId, SigningKeyStatus.REVOKED, actor);
  }

  async declareKeyCompromised(
    userId: string,
    signingKeyId: string,
    actor: Actor = { type: SigningActorType.USER, userId },
  ) {
    return this.transitionKey(userId, signingKeyId, SigningKeyStatus.COMPROMISED, actor);
  }

  async disableKey(userId: string, signingKeyId: string, actor: Actor = { type: SigningActorType.ADMIN }) {
    return this.transitionKey(userId, signingKeyId, SigningKeyStatus.DISABLED, actor);
  }

  private async transitionKey(
    userId: string,
    signingKeyId: string,
    target: KeyTransitionTarget,
    actor: Actor,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const identity = await this.requireIdentity(transaction, userId);
      await this.lockIdentity(transaction, identity.id);
      const key = await transaction.signingKey.findFirst({
        where: { id: signingKeyId, signingIdentityId: identity.id },
      });
      if (!key) {
        throw new NotFoundException({
          message: 'Signing key not found.',
          code: 'SIGNING_KEY_NOT_FOUND',
        });
      }
      if (!ALLOWED_KEY_TRANSITIONS[key.status].includes(target)) {
        throw new ConflictException({
          message: 'Invalid signing key lifecycle transition.',
          code: 'INVALID_SIGNING_KEY_TRANSITION',
        });
      }

      const now = new Date();
      const timestampField = {
        [SigningKeyStatus.REVOKED]: { revokedAt: now },
        [SigningKeyStatus.COMPROMISED]: { compromisedAt: now },
        [SigningKeyStatus.DISABLED]: { disabledAt: now },
      }[target];
      const updatedKey = await transaction.signingKey.update({
        where: { id: key.id },
        data: { status: target, ...timestampField },
      });
      const eventType = {
        [SigningKeyStatus.REVOKED]: SigningKeyEventType.KEY_REVOKED,
        [SigningKeyStatus.COMPROMISED]: SigningKeyEventType.KEY_COMPROMISED,
        [SigningKeyStatus.DISABLED]: SigningKeyEventType.KEY_DISABLED,
      }[target];
      await this.createEvent(transaction, {
        signingIdentityId: identity.id,
        signingKeyId: key.id,
        eventType,
        actor,
        metadata: { keyVersion: key.keyVersion },
      });
      return updatedKey;
    });
  }

  async suspendIdentity(userId: string, actor: Actor = { type: SigningActorType.ADMIN }) {
    return this.transitionIdentity(userId, SigningIdentityStatus.SUSPENDED, SigningKeyEventType.IDENTITY_SUSPENDED, actor);
  }

  async reactivateIdentity(userId: string, actor: Actor = { type: SigningActorType.ADMIN }) {
    return this.transitionIdentity(userId, SigningIdentityStatus.ACTIVE, SigningKeyEventType.IDENTITY_REACTIVATED, actor);
  }

  async closeIdentity(userId: string, actor: Actor = { type: SigningActorType.ADMIN }) {
    return this.transitionIdentity(userId, SigningIdentityStatus.CLOSED, SigningKeyEventType.IDENTITY_CLOSED, actor);
  }

  private async transitionIdentity(
    userId: string,
    target: SigningIdentityStatus,
    eventType: SigningKeyEventType,
    actor: Actor,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const identity = await this.requireIdentity(transaction, userId);
      await this.lockIdentity(transaction, identity.id);
      const allowed =
        (identity.status === SigningIdentityStatus.ACTIVE && target !== SigningIdentityStatus.ACTIVE) ||
        (identity.status === SigningIdentityStatus.SUSPENDED && target !== SigningIdentityStatus.SUSPENDED);
      if (!allowed) {
        throw new ConflictException({
          message: 'Invalid signing identity lifecycle transition.',
          code: 'INVALID_SIGNING_IDENTITY_TRANSITION',
        });
      }
      const updated = await transaction.signingIdentity.update({
        where: { id: identity.id },
        data: {
          status: target,
          closedAt: target === SigningIdentityStatus.CLOSED ? new Date() : null,
        },
      });
      await this.createEvent(transaction, {
        signingIdentityId: identity.id,
        eventType,
        actor,
      });
      return updated;
    });
  }

  async createOperation(userId: string, operationType: SigningKeyOperationType, signingKeyId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      const identity = await this.requireIdentity(transaction, userId);
      if (signingKeyId) {
        const key = await transaction.signingKey.findFirst({
          where: { id: signingKeyId, signingIdentityId: identity.id },
          select: { id: true },
        });
        if (!key) {
          throw new NotFoundException({
            message: 'Signing key not found.',
            code: 'SIGNING_KEY_NOT_FOUND',
          });
        }
      }
      const operation = await transaction.signingKeyOperation.create({
        data: { signingIdentityId: identity.id, signingKeyId, operationType },
      });
      await this.createEvent(transaction, {
        signingIdentityId: identity.id,
        signingKeyId,
        eventType: SigningKeyEventType.KEY_OPERATION_REQUESTED,
        actor: { type: SigningActorType.USER, userId },
        correlationId: operation.correlationId,
        metadata: { operationType },
      });
      return operation;
    });
  }
}