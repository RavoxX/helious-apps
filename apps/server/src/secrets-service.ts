import { ObjectId, type ClientSession, type Db } from 'mongodb';
import type { FastifyRequest } from 'fastify';
import { canReadSecret } from '@helious/core';
import { collections, type UserDocument } from './db.js';
import type { KeyRing } from './encryption.js';
import { createVaultAccess, type PrincipalResolver, type AccessVerifier } from './vault-access.js';
import { vaultCollections } from './vault-db.js';
import { policy } from './spaces.js';
import { withVaultWrite } from './vault-writes.js';
import { securityCollections, secretContext, type SecretDocument } from './security-db.js';
import { appendAudit, ensureAuditHead, type AuditEvent } from './secret-audit.js';
import { securityError, type Proof, type SecurityService } from './security-service.js';

export const secretMetadata = (secret: SecretDocument) => ({
  id: secret._id.toHexString(),
  vaultId: secret.vaultId.toHexString(),
  spaceId: secret.spaceId.toHexString(),
  name: secret.name,
  kind: secret.kind,
  agentAccess: secret.agentAccess,
  requireApproval: secret.requireApproval,
  revision: secret.revision,
  createdAt: secret.createdAt.toISOString(),
  updatedAt: secret.updatedAt.toISOString(),
});
export interface SecretInput {
  name: string;
  kind: SecretDocument['kind'];
  spaceId: string;
  value?: string;
  agentAccess: 'none' | 'read';
  requireApproval: boolean;
}
export function createSecretsService(
  db: Db,
  ring: KeyRing,
  security: SecurityService,
  principal?: PrincipalResolver,
  verify?: AccessVerifier,
) {
  const access = createVaultAccess(db, principal),
    store = securityCollections(db),
    vaults = vaultCollections(db),
    accounts = collections(db);
  const actor = (request: FastifyRequest) => ({
    kind: access.principal(request).kind,
    id: access.principal(request).actorId,
  });
  const baseEvent = (
    request: FastifyRequest,
    vaultId: string,
    action: AuditEvent['action'],
    secretId?: string,
  ) => ({
    ownerId: access.owner(request),
    actor: actor(request),
    ip: request.ip,
    action,
    vaultId: new ObjectId(vaultId),
    ...(secretId ? { secretId: new ObjectId(secretId) } : {}),
  });
  async function ownerLock(request: FastifyRequest, session: ClientSession) {
    await verify?.(request, session);
    if (access.principal(request).kind === 'user')
      return security.lockSession(request, session, true);
    const owner = await accounts.users.findOneAndUpdate(
      { _id: access.owner(request), emailVerified: true, totpEnabled: true },
      { $inc: { securityRevision: 1 } },
      { session, returnDocument: 'after' },
    );
    if (!owner || !(await store.credentials.findOne({ _id: owner._id }, { session })))
      throw securityError('Secret access is not permitted.', 404);
    return owner;
  }
  async function transaction<T>(
    request: FastifyRequest,
    vaultId: string,
    action: AuditEvent['action'],
    secretId: string | undefined,
    work: (user: UserDocument, session: ClientSession) => Promise<T>,
    proof?: Proof,
  ) {
    const event = baseEvent(request, vaultId, action, secretId);
    await ensureAuditHead(db, event.ownerId);
    try {
      const current = access.principal(request);
      if (current.kind === 'agent' && !current.vaultIds.includes(vaultId))
        throw securityError('Secret not found', 404);
      if (proof) {
        access.requireOwner(request);
        await security.prove(request, proof);
      }
      return await withVaultWrite(
        db,
        new ObjectId(vaultId),
        event.ownerId,
        async (session) => work(await ownerLock(request, session), session),
        'A secret with this name already exists in this vault.',
      );
    } catch (error) {
      await appendAudit(db, {
        ...event,
        outcome:
          error instanceof Error &&
          'statusCode' in error &&
          typeof error.statusCode === 'number' &&
          error.statusCode < 500
            ? 'denied'
            : 'error',
      });
      throw error;
    }
  }
  async function readable(
    request: FastifyRequest,
    vaultId: string,
    id: string,
    session: ClientSession,
  ) {
    const secret = await store.secrets.findOne(
      { ...access.base(request, vaultId), _id: new ObjectId(id), state: 'active' },
      { session },
    );
    const space = secret
      ? await vaults.spaces.findOne(
          { ...access.base(request, vaultId), _id: secret.spaceId },
          { session },
        )
      : null;
    if (
      !secret ||
      !space ||
      !canReadSecret(access.principal(request), policy(space), {
        id,
        ownerId: secret.ownerId.toHexString(),
        vaultId,
        spaceId: secret.spaceId.toHexString(),
        agentAccess: secret.agentAccess,
      })
    )
      throw securityError('Secret not found', 404);
    return { secret, space };
  }
  async function list(request: FastifyRequest, vaultId: string, spaceId?: string) {
    return transaction(request, vaultId, 'secret.list', undefined, async (_user, session) => {
      const current = access.principal(request);
      const spaces = await vaults.spaces
        .find(
          { ...access.base(request, vaultId), ...(spaceId ? { _id: new ObjectId(spaceId) } : {}) },
          { session },
        )
        .toArray();
      const allowed = spaces.filter(
        (space) =>
          current.kind === 'user' ||
          (current.spaceIds.includes(space._id.toHexString()) && space.agentAccess !== 'none'),
      );
      if (spaceId && !allowed.length) throw securityError('Space not found', 404);
      const ids =
        current.kind === 'agent'
          ? current.scopes.flatMap((scope) =>
              /^secrets:read:[a-f\d]{24}$/.test(scope) ? [new ObjectId(scope.slice(13))] : [],
            )
          : null;
      const secrets = await store.secrets
        .find(
          {
            ...access.base(request, vaultId),
            spaceId: { $in: allowed.map((space) => space._id) },
            state: 'active',
            ...(ids ? { _id: { $in: ids }, agentAccess: 'read' as const } : {}),
          },
          { session, projection: { encrypted: 0 } },
        )
        .sort({ nameKey: 1 })
        .limit(100)
        .toArray();
      await appendAudit(
        db,
        {
          ...baseEvent(request, vaultId, 'secret.list'),
          outcome: 'success',
          ...(spaceId ? { spaceId: new ObjectId(spaceId) } : {}),
        },
        session,
      );
      return { secrets: secrets.map(secretMetadata), limit: 100 };
    });
  }
  async function create(
    request: FastifyRequest,
    vaultId: string,
    input: SecretInput,
    proof: Proof,
  ) {
    access.requireOwner(request);
    const id = new ObjectId();
    return transaction(
      request,
      vaultId,
      'secret.create',
      id.toHexString(),
      async (_user, session) => {
        const space = await access.requireSpace(request, vaultId, input.spaceId, 'write', session);
        const value = Buffer.from(input.value ?? '', 'utf8');
        if (value.length < 1 || value.length > 65536)
          throw securityError('Secret values must contain 1–65,536 UTF-8 bytes.', 400);
        const now = new Date();
        const secret: SecretDocument = {
          _id: id,
          ...access.base(request, vaultId),
          spaceId: space._id,
          name: input.name,
          nameKey: input.name.normalize('NFC').toLowerCase(),
          kind: input.kind,
          agentAccess: input.agentAccess,
          requireApproval: input.requireApproval,
          state: 'active',
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        try {
          secret.encrypted = ring.encrypt(value, secretContext(secret));
        } finally {
          value.fill(0);
        }
        await store.secrets.insertOne(secret, { session });
        await appendAudit(
          db,
          {
            ...baseEvent(request, vaultId, 'secret.create', id.toHexString()),
            spaceId: secret.spaceId,
            outcome: 'success',
          },
          session,
        );
        return { secret: secretMetadata(secret) };
      },
      proof,
    );
  }
  async function update(
    request: FastifyRequest,
    vaultId: string,
    id: string,
    revision: number,
    input: SecretInput,
    proof: Proof,
  ) {
    access.requireOwner(request);
    return transaction(
      request,
      vaultId,
      'secret.update',
      id,
      async (_user, session) => {
        const { secret } = await readable(request, vaultId, id, session);
        if (secret.revision !== revision)
          throw securityError('This secret changed elsewhere. Refresh before saving.', 409);
        const target = await access.requireSpace(request, vaultId, input.spaceId, 'write', session);
        const next = {
          ...secret,
          spaceId: target._id,
          name: input.name,
          nameKey: input.name.normalize('NFC').toLowerCase(),
          kind: input.kind,
          agentAccess: input.agentAccess,
          requireApproval: input.requireApproval,
          revision: secret.revision + 1,
          updatedAt: new Date(),
        };
        const bytes =
          input.value !== undefined
            ? Buffer.from(input.value, 'utf8')
            : ring.decrypt(secret.encrypted!, secretContext(secret));
        if (bytes.length < 1 || bytes.length > 65536) {
          bytes.fill(0);
          throw securityError('Secret values must contain 1–65,536 UTF-8 bytes.', 400);
        }
        try {
          next.encrypted = ring.encrypt(bytes, secretContext(next));
        } finally {
          bytes.fill(0);
        }
        await store.secrets.replaceOne({ _id: secret._id, revision }, { ...next }, { session });
        await store.approvals.updateMany(
          { secretId: secret._id, state: { $in: ['pending', 'approved'] } },
          { $set: { state: 'denied', decidedAt: new Date() } },
          { session },
        );
        await appendAudit(
          db,
          {
            ...baseEvent(request, vaultId, 'secret.update', id),
            spaceId: next.spaceId,
            outcome: 'success',
          },
          session,
        );
        return { secret: secretMetadata(next) };
      },
      proof,
    );
  }
  async function remove(
    request: FastifyRequest,
    vaultId: string,
    id: string,
    revision: number,
    proof: Proof,
  ) {
    access.requireOwner(request);
    return transaction(
      request,
      vaultId,
      'secret.delete',
      id,
      async (_user, session) => {
        const { secret } = await readable(request, vaultId, id, session);
        if (secret.revision !== revision)
          throw securityError('This secret changed elsewhere. Refresh before deleting.', 409);
        await store.secrets.updateOne(
          { _id: secret._id, revision },
          {
            $set: { state: 'deleted', updatedAt: new Date() },
            $unset: { encrypted: '' },
            $inc: { revision: 1 },
          },
          { session },
        );
        await store.approvals.updateMany(
          { secretId: secret._id, state: { $in: ['pending', 'approved'] } },
          { $set: { state: 'denied', decidedAt: new Date() } },
          { session },
        );
        await appendAudit(
          db,
          {
            ...baseEvent(request, vaultId, 'secret.delete', id),
            spaceId: secret.spaceId,
            outcome: 'success',
          },
          session,
        );
        return { ok: true };
      },
      proof,
    );
  }
  async function read(
    request: FastifyRequest,
    vaultId: string,
    id: string,
    proof: Proof,
    approvalId?: string,
  ) {
    return transaction(
      request,
      vaultId,
      'secret.read',
      id,
      async (user, session) => {
        const { secret, space } = await readable(request, vaultId, id, session);
        const current = access.principal(request);
        if (current.kind === 'agent' && secret.requireApproval) {
          if (!approvalId) {
            const pending = {
              _id: new ObjectId(),
              ...access.base(request, vaultId),
              spaceId: secret.spaceId,
              secretId: secret._id,
              agentId: current.actorId,
              secretRevision: secret.revision,
              spaceRevision: space.revision,
              ownerAuthVersion: user.authVersion,
              state: 'pending' as const,
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + 600000),
            };
            // Repeated requests return the existing live request rather than spamming the inbox.
            const existing = await store.approvals.findOne(
              {
                ownerId: pending.ownerId,
                secretId: secret._id,
                agentId: current.actorId,
                secretRevision: secret.revision,
                spaceRevision: space.revision,
                ownerAuthVersion: user.authVersion,
                state: 'pending',
                expiresAt: { $gt: new Date() },
              },
              { session },
            );
            if (!existing) await store.approvals.insertOne(pending, { session });
            const chosen = existing ?? pending;
            await appendAudit(
              db,
              {
                ...baseEvent(request, vaultId, 'secret.request', id),
                spaceId: secret.spaceId,
                approvalId: chosen._id,
                outcome: 'pending',
              },
              session,
            );
            return {
              pending: true as const,
              approvalId: chosen._id.toHexString(),
              expiresAt: chosen.expiresAt.toISOString(),
            };
          }
          const approval = await store.approvals.findOneAndUpdate(
            {
              _id: new ObjectId(approvalId),
              ownerId: user._id,
              secretId: secret._id,
              agentId: current.actorId,
              secretRevision: secret.revision,
              spaceRevision: space.revision,
              ownerAuthVersion: user.authVersion,
              state: 'approved',
              expiresAt: { $gt: new Date() },
            },
            { $set: { state: 'used', usedAt: new Date() } },
            { session, returnDocument: 'after' },
          );
          if (!approval)
            throw securityError(
              'Approval is expired, already used, changed or not permitted.',
              403,
            );
        }
        const bytes = ring.decrypt(secret.encrypted!, secretContext(secret));
        let value: string;
        try {
          value = bytes.toString('utf8');
        } finally {
          bytes.fill(0);
        }
        await appendAudit(
          db,
          {
            ...baseEvent(request, vaultId, 'secret.read', id),
            spaceId: secret.spaceId,
            outcome: 'success',
            ...(approvalId ? { approvalId: new ObjectId(approvalId) } : {}),
          },
          session,
        );
        return { value, hideAfterSeconds: 30 };
      },
      access.principal(request).kind === 'user' ? proof : undefined,
    );
  }
  async function decide(request: FastifyRequest, id: string, approved: boolean, proof: Proof) {
    access.requireOwner(request);
    const before = await store.approvals.findOne({
      _id: new ObjectId(id),
      ownerId: access.owner(request),
    });
    if (!before) throw securityError('Approval not found', 404);
    return transaction(
      request,
      before.vaultId.toHexString(),
      'secret.approve',
      before.secretId.toHexString(),
      async (user, session) => {
        const { secret, space } = await readable(
          request,
          before.vaultId.toHexString(),
          before.secretId.toHexString(),
          session,
        );
        const changed = await store.approvals.findOneAndUpdate(
          {
            _id: before._id,
            ownerId: user._id,
            state: 'pending',
            secretRevision: secret.revision,
            spaceRevision: space.revision,
            ownerAuthVersion: user.authVersion,
            expiresAt: { $gt: new Date() },
          },
          {
            $set: {
              state: approved ? 'approved' : 'denied',
              decidedAt: new Date(),
              approverId: user._id,
            },
          },
          { session, returnDocument: 'after' },
        );
        if (!changed)
          throw securityError('Approval expired or changed. Refresh the request list.', 409);
        await appendAudit(
          db,
          {
            ...baseEvent(
              request,
              before.vaultId.toHexString(),
              'secret.approve',
              secret._id.toHexString(),
            ),
            spaceId: secret.spaceId,
            approvalId: before._id,
            outcome: approved ? 'approved' : 'rejected',
          },
          session,
        );
        return { ok: true };
      },
      approved ? proof : undefined,
    );
  }
  return { list, create, update, remove, read, decide };
}
export type SecretsService = ReturnType<typeof createSecretsService>;
