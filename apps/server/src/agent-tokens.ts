import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ObjectId, type Db, type ClientSession } from 'mongodb';
import type { FastifyRequest } from 'fastify';
import type { KnowledgePrincipal } from '@helious/core';
import { collections } from './db.js';
import { vaultCollections } from './vault-db.js';
import { securityCollections } from './security-db.js';
import { securityError } from './security-service.js';
export const opaque = (prefix = '') => prefix + randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const constantEqual = (one: string, two: string) =>
  one.length === two.length && timingSafeEqual(Buffer.from(one), Buffer.from(two));
export type AgentScope = 'notes:read' | 'notes:write' | `secrets:read:${string}`;
export interface Grants {
  vaultIds: string[];
  spaceIds: string[];
  scopes: AgentScope[];
}
export interface AgentToken extends Grants {
  _id: ObjectId;
  ownerId: ObjectId;
  hash: string;
  kind: 'personal' | 'oauth';
  name: string;
  authVersion: number;
  createdAt: Date;
  expiresAt: Date;
  cleanupAt: Date;
  connectionExpiresAt?: Date;
  revokedAt?: Date;
  lastUsedAt?: Date;
  clientId?: string;
  familyId?: string;
  useRevision?: number;
}
export interface AgentContext {
  raw: string;
  token: AgentToken;
  principal: Extract<KnowledgePrincipal, { kind: 'agent' }>;
}
declare module 'fastify' {
  interface FastifyRequest {
    agent?: AgentContext;
  }
  interface FastifyContextConfig {
    credentialTransport?: 'bearer' | 'oauth';
  }
}
export function agentStore(db: Db) {
  return db.collection<AgentToken>('agent_tokens');
}
export const publicToken = (token: AgentToken) => ({
  id: token._id.toHexString(),
  name: token.name,
  kind: token.kind,
  vaultIds: token.vaultIds,
  spaceIds: token.spaceIds,
  scopes: token.scopes,
  createdAt: token.createdAt.toISOString(),
  expiresAt: (token.connectionExpiresAt ?? token.expiresAt).toISOString(),
  accessExpiresAt: token.expiresAt.toISOString(),
  revokedAt: token.revokedAt?.toISOString(),
  lastUsedAt: token.lastUsedAt?.toISOString(),
  clientId: token.clientId,
});
export async function initializeAgents(db: Db) {
  await Promise.all([
    agentStore(db).createIndex({ hash: 1 }, { unique: true }),
    agentStore(db).createIndex({ ownerId: 1, createdAt: -1 }),
    agentStore(db).createIndex({ cleanupAt: 1 }, { expireAfterSeconds: 0 }),
    agentStore(db).createIndex({ familyId: 1 }),
    db.collection('agent_activity').createIndex({ ownerId: 1, vaultId: 1, spaceId: 1, at: -1 }),
    db.collection('agent_activity').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}
export async function validateGrants(
  db: Db,
  ownerId: ObjectId,
  grants: Grants,
  personalConsent: string[],
  session?: ClientSession,
) {
  const store = vaultCollections(db);
  if (
    !grants.vaultIds.length ||
    !grants.spaceIds.length ||
    !grants.scopes.length ||
    grants.vaultIds.length > 30 ||
    grants.spaceIds.length > 100 ||
    grants.scopes.length > 100
  )
    throw securityError('Choose explicit vaults, Spaces and actions.', 400);
  if (grants.scopes.includes('notes:write') && !grants.scopes.includes('notes:read'))
    throw securityError('Note writing also requires note reading.', 400);
  const vaults = await store.vaults.countDocuments(
    { _id: { $in: grants.vaultIds.map((id) => new ObjectId(id)) }, ownerId, state: 'active' },
    { session },
  );
  const spaces = await store.spaces
    .find(
      {
        _id: { $in: grants.spaceIds.map((id) => new ObjectId(id)) },
        ownerId,
        vaultId: { $in: grants.vaultIds.map((id) => new ObjectId(id)) },
      },
      { session },
    )
    .toArray();
  if (
    vaults !== grants.vaultIds.length ||
    spaces.length !== grants.spaceIds.length ||
    spaces.some(
      (space) =>
        space.agentAccess === 'none' ||
        (grants.scopes.includes('notes:write') && space.agentAccess !== 'read-write'),
    )
  )
    throw securityError(
      'A selected vault or Space is unavailable or its policy does not allow these actions.',
      400,
    );
  if (
    spaces.some(
      (space) => space.kind === 'personal' && !personalConsent.includes(space._id.toHexString()),
    )
  )
    throw securityError('Explicitly confirm each Personal Space before sharing it.', 400);
  const secrets = grants.scopes
    .filter((scope) => scope.startsWith('secrets:read:'))
    .map((scope) => new ObjectId(scope.slice(13)));
  if (secrets.length) {
    const owner = await collections(db).users.findOne(
      { _id: ownerId, totpEnabled: true },
      { session },
    );
    if (!owner)
      throw securityError('Enable two-factor authentication before granting secrets.', 403);
    if (
      (await securityCollections(db).secrets.countDocuments(
        {
          _id: { $in: secrets },
          ownerId,
          state: 'active',
          agentAccess: 'read',
          spaceId: { $in: spaces.map((space) => space._id) },
        },
        { session },
      )) !== secrets.length
    )
      throw securityError('A secret is unavailable or does not allow agents.', 400);
  }
  return {
    vaultIds: [...new Set(grants.vaultIds)],
    spaceIds: [...new Set(grants.spaceIds)],
    scopes: [...new Set(grants.scopes)],
  };
}
export function createAgentTokens(db: Db) {
  const store = agentStore(db),
    accounts = collections(db);
  async function authenticate(
    raw: string,
    session?: ClientSession,
    lock = false,
  ): Promise<AgentContext> {
    if (!/^hel_(?:pat|at)_[A-Za-z0-9_-]{43}$/.test(raw))
      throw securityError('Invalid or expired agent token.', 401);
    const hash = digest(raw),
      token = await store.findOne(
        { hash, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
        { session },
      );
    if (!token || !constantEqual(token.hash, hash))
      throw securityError('Invalid or expired agent token.', 401);
    const filter = {
      _id: token.ownerId,
      emailVerified: true,
      authVersion: token.authVersion,
      ...(token.scopes.some((scope) => scope.startsWith('secrets:')) ? { totpEnabled: true } : {}),
    };
    const user = lock
      ? await accounts.users.findOneAndUpdate(
          filter,
          { $inc: { securityRevision: 1 } },
          { session, returnDocument: 'after' },
        )
      : await accounts.users.findOne(filter, { session });
    if (!user) throw securityError('Invalid or expired agent token.', 401);
    if (lock) {
      const updated = await store.updateOne(
        { _id: token._id, hash, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
        { $inc: { useRevision: 1 }, $set: { lastUsedAt: new Date() } },
        { session },
      );
      if (!updated.matchedCount) throw securityError('Invalid or expired agent token.', 401);
    } else
      await store.updateOne({ _id: token._id }, { $set: { lastUsedAt: new Date() } }, { session });
    return {
      raw,
      token,
      principal: {
        kind: 'agent',
        ownerId: token.ownerId.toHexString(),
        actorId: token._id.toHexString(),
        vaultIds: token.vaultIds,
        spaceIds: token.spaceIds,
        scopes: token.scopes,
      },
    };
  }
  async function issue(
    ownerId: ObjectId,
    name: string,
    grants: Grants,
    expiresAt: Date,
    options: {
      session?: ClientSession;
      clientId?: string;
      familyId?: string;
      connectionExpiresAt?: Date;
    } = {},
  ) {
    const user = await accounts.users.findOne(
      { _id: ownerId, emailVerified: true },
      { session: options.session },
    );
    if (!user) throw securityError('Account is unavailable.', 403);
    const raw = opaque(options.clientId ? 'hel_at_' : 'hel_pat_');
    const token: AgentToken = {
      _id: new ObjectId(),
      ownerId,
      name,
      hash: digest(raw),
      kind: options.clientId ? 'oauth' : 'personal',
      ...grants,
      authVersion: user.authVersion,
      createdAt: new Date(),
      expiresAt,
      cleanupAt: new Date((options.connectionExpiresAt ?? expiresAt).getTime() + 30 * 86400000),
      ...(options.connectionExpiresAt ? { connectionExpiresAt: options.connectionExpiresAt } : {}),
      ...(options.clientId ? { clientId: options.clientId, familyId: options.familyId } : {}),
    };
    await store.insertOne(token, { session: options.session });
    return { raw, token };
  }
  async function verify(request: FastifyRequest, session?: ClientSession) {
    if (request.agent) {
      const current = await authenticate(request.agent.raw, session, !!session);
      if (current.token._id.toHexString() !== request.agent.token._id.toHexString())
        throw securityError('Invalid token.', 401);
      request.agent = current;
    }
  }
  async function revoke(ownerId: ObjectId, id: string) {
    await db.client.withSession((session) =>
      session.withTransaction(async () => {
        await accounts.users.updateOne(
          { _id: ownerId },
          { $inc: { securityRevision: 1 } },
          { session },
        );
        const token = await store.findOne({ _id: new ObjectId(id), ownerId }, { session });
        if (!token) throw securityError('Token not found.', 404);
        await store.updateMany(
          { ownerId, ...(token.familyId ? { familyId: token.familyId } : { _id: token._id }) },
          { $set: { revokedAt: new Date() } },
          { session },
        );
        if (token.familyId)
          await db
            .collection('oauth_refresh')
            .updateMany(
              { ownerId, familyId: token.familyId },
              { $set: { revokedAt: new Date() } },
              { session },
            );
      }),
    );
    return { ok: true };
  }
  return { authenticate, issue, verify, revoke };
}
export type AgentTokens = ReturnType<typeof createAgentTokens>;
