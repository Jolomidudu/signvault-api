import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { PrismaService } from '../prisma/prisma.service';
import { SigningDomainService, type CreateSigningKeyMetadata } from './signing-domain.service';

type IdentityRow = {
  id: string;
  userId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

type KeyRow = {
  id: string;
  signingIdentityId: string;
  keyVersion: number;
  algorithmProfile: string;
  provider: 'AWS_KMS';
  providerKeyReference: string;
  publicKey: Uint8Array;
  publicKeyFormat: 'SPKI_DER';
  fingerprint: string;
  status: 'PENDING' | 'ACTIVE' | 'ROTATED' | 'REVOKED' | 'COMPROMISED' | 'DISABLED';
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  compromisedAt: Date | null;
  disabledAt: Date | null;
};

type EventRow = Record<string, unknown>;
type OperationRow = Record<string, unknown>;

type DatabaseState = {
  user: { id: string; accountStatus: string; emailVerified: boolean };
  identities: IdentityRow[];
  keys: KeyRow[];
  events: EventRow[];
  operations: OperationRow[];
  sequence: number;
};

function uniqueError() {
  return Object.assign(new Error('Unique constraint violation'), { code: 'P2002' });
}

function createHarness() {
  let state: DatabaseState = {
    user: { id: 'user-1', accountStatus: 'ACTIVE', emailVerified: true },
    identities: [],
    keys: [],
    events: [],
    operations: [],
    sequence: 0,
  };
  let failEventWrites = false;

  const makeTransaction = (draft: DatabaseState) => ({
    $queryRaw: async () => [],
    user: {
      findUnique: async () => draft.user,
    },
    signingIdentity: {
      findUnique: async ({ where }: { where: { userId: string } }) => {
        const identity = draft.identities.find((item) => item.userId === where.userId);
        return identity ? { ...identity, user: draft.user } : null;
      },
      create: async ({ data }: { data: { userId: string } }) => {
        if (draft.identities.some((item) => item.userId === data.userId)) throw uniqueError();
        draft.sequence += 1;
        const identity: IdentityRow = {
          id: `identity-${draft.sequence}`,
          userId: data.userId,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          closedAt: null,
        };
        draft.identities.push(identity);
        return identity;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<IdentityRow> }) => {
        const identity = draft.identities.find((item) => item.id === where.id);
        if (!identity) throw new Error('Identity missing');
        Object.assign(identity, data);
        return identity;
      },
    },
    signingKey: {
      findFirst: async ({ where, orderBy }: {
        where: { id?: string; signingIdentityId?: string; status?: KeyRow['status'] };
        orderBy?: { keyVersion: 'desc' };
      }) => {
        const matches = draft.keys.filter((key) =>
          (!where.id || key.id === where.id) &&
          (!where.signingIdentityId || key.signingIdentityId === where.signingIdentityId) &&
          (!where.status || key.status === where.status));
        if (orderBy?.keyVersion === 'desc') matches.sort((left, right) => right.keyVersion - left.keyVersion);
        return matches[0] ?? null;
      },
      create: async ({ data }: { data: Omit<KeyRow, 'id' | 'createdAt' | 'updatedAt' | 'activatedAt' | 'rotatedAt' | 'revokedAt' | 'compromisedAt' | 'disabledAt' | 'status'> }) => {
        if (draft.keys.some((key) =>
          (key.signingIdentityId === data.signingIdentityId && key.keyVersion === data.keyVersion) ||
          (key.provider === data.provider && key.providerKeyReference === data.providerKeyReference) ||
          key.fingerprint === data.fingerprint)) throw uniqueError();
        draft.sequence += 1;
        const now = new Date();
        const key: KeyRow = {
          ...data,
          id: `key-${draft.sequence}`,
          status: 'PENDING',
          createdAt: now,
          updatedAt: now,
          activatedAt: null,
          rotatedAt: null,
          revokedAt: null,
          compromisedAt: null,
          disabledAt: null,
        };
        draft.keys.push(key);
        return key;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<KeyRow> }) => {
        const key = draft.keys.find((item) => item.id === where.id);
        if (!key) throw new Error('Key missing');
        const nextStatus = data.status ?? key.status;
        if (nextStatus === 'ACTIVE' && draft.keys.some((item) =>
          item.id !== key.id && item.signingIdentityId === key.signingIdentityId && item.status === 'ACTIVE')) {
          throw uniqueError();
        }
        Object.assign(key, data);
        return key;
      },
    },
    signingKeyEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (failEventWrites) throw new Error('Event persistence failed');
        const event = { ...data, id: `event-${draft.events.length + 1}`, createdAt: new Date() };
        draft.events.push(event);
        return event;
      },
    },
    signingKeyOperation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        draft.sequence += 1;
        const operation = {
          ...data,
          id: `operation-${draft.sequence}`,
          correlationId: `correlation-${draft.sequence}`,
          status: 'PENDING',
          attemptCount: 0,
          safeErrorCode: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
        };
        draft.operations.push(operation);
        return operation;
      },
    },
  });

  const prisma = {
    $transaction: async <T>(callback: (transaction: never) => Promise<T>) => {
      const draft = structuredClone(state);
      const result = await callback(makeTransaction(draft) as never);
      state = draft;
      return result;
    },
  };

  return {
    service: new SigningDomainService(prisma as unknown as PrismaService),
    state: () => state,
    setUser: (user: DatabaseState['user']) => { state.user = user; },
    failNextEvent: () => { failEventWrites = true; },
  };
}

function keyMetadata(providerKeyReference: string, publicKey: number[] = [1, 2, 3]): CreateSigningKeyMetadata {
  return {
    algorithmProfile: 'ED25519_V1',
    provider: 'AWS_KMS',
    providerKeyReference,
    publicKey: Buffer.from(publicKey),
    publicKeyFormat: 'SPKI_DER',
  };
}

describe('SigningDomainService', () => {
  it('allows exactly one signing identity per user and journals creation', async () => {
    const harness = createHarness();
    const identity = await harness.service.createIdentity('user-1');

    await expect(harness.service.createIdentity('user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(harness.state().identities).toHaveLength(1);
    expect(harness.state().events).toMatchObject([{ eventType: 'IDENTITY_CREATED', actorUserId: 'user-1' }]);
    expect(identity.userId).toBe('user-1');
  });

  it('rejects identity creation for an inactive or unverified account', async () => {
    const harness = createHarness();
    harness.setUser({ id: 'user-1', accountStatus: 'SUSPENDED', emailVerified: true });

    await expect(harness.service.createIdentity('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.state().identities).toHaveLength(0);
  });

  it('assigns positive monotonically increasing key versions and stores only public metadata', async () => {
    const harness = createHarness();
    await harness.service.createIdentity('user-1');
    const first = await harness.service.createPendingKey('user-1', keyMetadata('kms-key-1'));
    const second = await harness.service.createPendingKey('user-1', keyMetadata('kms-key-2', [4, 5, 6]));

    expect([first.keyVersion, second.keyVersion]).toEqual([1, 2]);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.publicKey).toEqual(Uint8Array.from([1, 2, 3]));
    expect(Object.keys(first)).not.toEqual(expect.arrayContaining([
      'privateKey', 'encryptedPrivateKey', 'privateKeyCiphertext', 'wrappedPrivateKey', 'dataEncryptionKey',
      'privateJwk', 'seed', 'mnemonic', 'secretKeyBytes',
    ]));
  });

  it('rejects duplicate fingerprints and provider references', async () => {
    const harness = createHarness();
    await harness.service.createIdentity('user-1');
    await harness.service.createPendingKey('user-1', keyMetadata('kms-key-1'));

    await expect(harness.service.createPendingKey('user-1', keyMetadata('kms-key-2')))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(harness.service.createPendingKey('user-1', keyMetadata('kms-key-1', [8, 9, 10])))
      .rejects.toBeInstanceOf(ConflictException);
    expect(harness.state().keys).toHaveLength(1);
  });

  it('rotates atomically, preserves historical public keys, and leaves one active key', async () => {
    const harness = createHarness();
    await harness.service.createIdentity('user-1');
    const oldKey = await harness.service.createPendingKey('user-1', keyMetadata('kms-key-1'));
    const newKey = await harness.service.createPendingKey('user-1', keyMetadata('kms-key-2', [4, 5, 6]));

    await harness.service.activateOrRotatePendingKey('user-1', oldKey.id);
    await harness.service.activateOrRotatePendingKey('user-1', newKey.id);

    const keys = harness.state().keys;
    expect(keys.filter((key) => key.status === 'ACTIVE')).toHaveLength(1);
    expect(keys.find((key) => key.id === oldKey.id)).toMatchObject({
      status: 'ROTATED',
      publicKey: Uint8Array.from([1, 2, 3]),
    });
    expect(keys.find((key) => key.id === newKey.id)?.status).toBe('ACTIVE');
    expect(harness.state().events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'KEY_ROTATED_OUT', signingKeyId: oldKey.id }),
      expect.objectContaining({ eventType: 'KEY_ROTATED', signingKeyId: newKey.id }),
    ]));
  });

  it('rejects invalid lifecycle transitions and preserves public material on revocation and compromise', async () => {
    const harness = createHarness();
    await harness.service.createIdentity('user-1');
    const revoked = await harness.service.createPendingKey('user-1', keyMetadata('kms-key-1'));
    const compromised = await harness.service.createPendingKey('user-1', keyMetadata('kms-key-2', [4, 5, 6]));
    await harness.service.activateOrRotatePendingKey('user-1', compromised.id);

    await harness.service.revokeKey('user-1', revoked.id);
    await expect(harness.service.revokeKey('user-1', revoked.id)).rejects.toBeInstanceOf(ConflictException);
    await harness.service.declareKeyCompromised('user-1', compromised.id);

    expect(harness.state().keys.find((key) => key.id === revoked.id)).toMatchObject({
      status: 'REVOKED',
      publicKey: Uint8Array.from([1, 2, 3]),
    });
    expect(harness.state().keys.find((key) => key.id === compromised.id)).toMatchObject({
      status: 'COMPROMISED',
      publicKey: Uint8Array.from([4, 5, 6]),
    });
  });

  it('rolls back a key state transition when its lifecycle event cannot be persisted', async () => {
    const harness = createHarness();
    await harness.service.createIdentity('user-1');
    const key = await harness.service.createPendingKey('user-1', keyMetadata('kms-key-1'));
    const priorEventCount = harness.state().events.length;
    harness.failNextEvent();

    await expect(harness.service.activateOrRotatePendingKey('user-1', key.id)).rejects.toThrow('Event persistence failed');
    expect(harness.state().keys.find((item) => item.id === key.id)?.status).toBe('PENDING');
    expect(harness.state().events).toHaveLength(priorEventCount);
  });

  it('persists provider operation records and correlated lifecycle events without a key row', async () => {
    const harness = createHarness();
    await harness.service.createIdentity('user-1');
    const operation = await harness.service.createOperation('user-1', 'PROVISION_KEY');

    expect(operation).toMatchObject({ signingKeyId: undefined, status: 'PENDING', operationType: 'PROVISION_KEY' });
    expect(harness.state().events).toContainEqual(expect.objectContaining({
      eventType: 'KEY_OPERATION_REQUESTED',
      correlationId: operation.correlationId,
    }));
  });

  it('defines the database-enforced version, fingerprint, provider-reference, and one-active-key constraints', () => {
    const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20261015000000_add_signing_identity_foundation/migration.sql'), 'utf8');
    expect(migration).toContain('CHECK ("keyVersion" > 0)');
    expect(migration).toContain('"SigningKey_signingIdentityId_keyVersion_key"');
    expect(migration).toContain('"SigningKey_fingerprint_key"');
    expect(migration).toContain('"SigningKey_provider_providerKeyReference_key"');
    expect(migration).toContain('WHERE "status" = \'ACTIVE\'');
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });

  it('keeps private-key material out of the persistence schema', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/privateKey|encryptedPrivateKey|privateKeyCiphertext|wrappedPrivateKey|dataEncryptionKey|privateJwk|mnemonic|secretKeyBytes/i);
    expect(schema).toContain('assetChecksum');
    expect(schema).toContain('model SignatureVersion');
    expect(schema).toContain('model VerificationRecord');
  });
});