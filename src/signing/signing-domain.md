# Signing Domain Persistence Invariants

The signing domain is separate from visual signatures and their assets. `assetChecksum` remains visual-asset integrity metadata. This module stores identity and key lifecycle metadata only; it does not generate keys, call a provider, hash documents, sign, or verify documents.

## Key material

`SigningKey.publicKey` stores SubjectPublicKeyInfo DER bytes. The service fingerprints those bytes with SHA-256 so the stored fingerprint is reproducible. Provider references are sensitive metadata. No private-key material, ciphertext, seed, or secret key bytes belong in these models, events, operations, or API responses.

## Lifecycle transactions

Every identity or key state transition and its `SigningKeyEvent` are written in one Prisma transaction. Event-write failure must abort that transaction. Key transitions lock the identity row's logical sequence with a PostgreSQL transaction-scoped advisory lock; the migration's partial unique index remains the database-level guard that permits at most one `ACTIVE` key per identity.

Rotation changes the old active key to `ROTATED` and activates the pending replacement in the same transaction. Revocation, compromise, and disablement update lifecycle metadata only and retain the public key.

## Append-only event invariant

Application code only creates `SigningKeyEvent` rows; it has no event update or delete operation. Lifecycle changes must append an event in the same transaction. Prisma and the current database role do not make rows absolutely immutable, so database-role separation, triggers, or external retention controls remain a later hardening decision. Event metadata is limited to allowlisted, non-secret values assembled internally by the domain service.

## Provider operations

`SigningKeyOperation` is durable metadata for a future provider action. Creating an operation does not call AWS. An operation can exist before a key row, allowing later provider work and reconciliation to associate a key. There is no worker or public HTTP API in this phase.