import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import Fastify, { type FastifyInstance } from 'fastify';
import type { KnowledgePrincipal } from '@helious/core';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryEmailService } from '../src/email.js';
import { collections } from '../src/db.js';
import { securityCollections, initializeSecurityDatabase } from '../src/security-db.js';
import { KeyRing } from '../src/encryption.js';
import { createSecurityService } from '../src/security-service.js';
import { createSecretsService } from '../src/secrets-service.js';
import { fromBase32, totpCode } from '../src/totp.js';
import { auditHash, type AuditRecord } from '../src/secret-audit.js';
import { rotateKeys } from '../src/key-rotation.js';
const origin = 'http://localhost:3000',
  password = 'a private secrets testing passphrase',
  value = 'synthetic-phase6-api-credential';
const mail = new MemoryEmailService(),
  ring = new KeyRing('v1', 'a'.repeat(64));
let mongo: MongoMemoryReplSet,
  client: MongoClient,
  db: Db,
  app: FastifyInstance,
  headers: Record<string, string>,
  vaultId: string,
  spaceId: string,
  userId: ObjectId,
  recovery: string[];
const send = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  h = headers,
) =>
  app.inject({ method, url, headers: h, ...(method !== 'GET' ? { payload: payload ?? {} } : {}) });
const base = () => `/api/vaults/${vaultId}/secrets`;
function cookie(response: { cookies: { name: string; value: string }[] }) {
  const token = response.cookies.find((c) => c.name === 'helious_session');
  if (token)
    headers.cookie =
      headers.cookie!.replace(/; helious_session=[^;]+/, '') + `; helious_session=${token.value}`;
}
async function enroll() {
  const setup = await send('POST', '/api/account/totp/setup', { password });
  expect(setup.statusCode, setup.body).toBe(200);
  const seed = fromBase32(setup.json().secret),
    code = totpCode(seed, Math.floor(Date.now() / 30000));
  const enabled = await send('POST', '/api/account/totp/enable', { code });
  expect(enabled.statusCode, enabled.body).toBe(200);
  cookie(enabled);
  recovery = enabled.json().recoveryCodes;
  return { seed, code };
}
async function create(extra = {}) {
  const result = await send('POST', base(), {
    name: 'Deploy key',
    kind: 'api-key',
    spaceId,
    value,
    agentAccess: 'read',
    requireApproval: true,
    password,
    ...extra,
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json().secret as { id: string; revision: number };
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '7.0.24' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('secrets-tests');
});
beforeEach(async () => {
  await db.dropDatabase();
  mail.messages.length = 0;
  app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      PUBLIC_URL: origin,
      COOKIE_SECURE: 'false',
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
    }),
    db,
    { staticFiles: false, emailService: mail },
  );
  await app.ready();
  const csrf = await app.inject('/api/auth/csrf');
  headers = {
    origin,
    'content-type': 'application/json',
    'x-csrf-token': csrf.json().csrfToken,
    cookie: `helious_csrf=${csrf.cookies.find((c) => c.name === 'helious_csrf')!.value}`,
  };
  expect(
    (
      await send('POST', '/api/auth/register', {
        name: 'Security tester',
        email: 'security@example.com',
        password,
      })
    ).statusCode,
  ).toBe(201);
  const token = /token=([\w-]+)/.exec(mail.messages.at(-1)!.text)![1];
  await send('POST', '/api/auth/verify-email', { token });
  cookie(await send('POST', '/api/auth/login', { email: 'security@example.com', password }));
  userId = (await collections(db).users.findOne({ email: 'security@example.com' }))!._id;
  const vault = await send('POST', '/api/vaults', { name: 'Secrets test' });
  vaultId = vault.json().vault.id;
  spaceId = (await send('GET', `/api/vaults/${vaultId}/spaces`))
    .json()
    .spaces.find((space: { name: string }) => space.name === 'Code').id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});
afterAll(async () => {
  await client.close();
  await mongo.stop();
});
it('requires MFA before secrets, rotates sessions on enrollment, blocks missing and reused factors at login', async () => {
  expect((await send('GET', base())).statusCode).toBe(401);
  const oldCookie = headers.cookie!,
    { code } = await enroll();
  expect(
    (await send('GET', '/api/auth/me', undefined, { ...headers, cookie: oldCookie })).statusCode,
  ).toBe(401);
  expect(
    (await send('POST', '/api/auth/login', { email: 'security@example.com', password })).json()
      .code,
  ).toBe('TOTP_REQUIRED');
  expect(
    (
      await send('POST', '/api/auth/login', { email: 'security@example.com', password, code })
    ).json().code,
  ).toBe('TOTP_INVALID');
  const login = await send('POST', '/api/auth/login', {
    email: 'security@example.com',
    password,
    code: recovery[0],
  });
  expect(login.statusCode).toBe(200);
  cookie(login);
  expect(
    (
      await send('POST', '/api/auth/login', {
        email: 'security@example.com',
        password,
        code: recovery[0],
      })
    ).statusCode,
  ).toBe(401);
  expect((await send('GET', '/api/security/status')).json().recoveryCodesRemaining).toBe(9);
});
it('binds setup to a session, auth version and ten-minute expiry and enforces reauthentication limits', async () => {
  const first = await send('POST', '/api/account/totp/setup', { password });
  await securityCollections(db).enrollments.updateMany(
    {},
    { $set: { expiresAt: new Date(Date.now() - 1) } },
  );
  expect(
    (
      await send('POST', '/api/account/totp/enable', {
        code: totpCode(fromBase32(first.json().secret), Math.floor(Date.now() / 30000)),
      })
    ).statusCode,
  ).toBe(400);
  for (let i = 0; i < 5; i++)
    expect(
      (await send('POST', '/api/account/totp/setup', { password: 'incorrect password' }))
        .statusCode,
    ).toBe(403);
  expect((await send('POST', '/api/account/totp/setup', { password })).statusCode).toBe(429);
  expect(await securityCollections(db).credentials.countDocuments({})).toBe(0);
});
it('stores ciphertext only, excludes values from knowledge APIs, audits reveals and requires CAS for changes', async () => {
  await enroll();
  const secret = await create();
  const stored = await securityCollections(db).secrets.findOne({ _id: new ObjectId(secret.id) });
  expect(JSON.stringify(stored)).not.toContain(value);
  expect(stored!.encrypted?.keyId).toBe('v1');
  const metadata = await send('GET', base());
  expect(metadata.body).not.toContain(value);
  expect(metadata.body).not.toContain('encrypted');
  expect(
    (await send('POST', `${base()}/${secret.id}/access`, { password: 'wrong' })).statusCode,
  ).toBe(403);
  const read = await send('POST', `${base()}/${secret.id}/access`, { password });
  expect(read.json().value).toBe(value);
  expect(read.headers['cache-control']).toContain('no-store');
  for (const suffix of ['/search?q=synthetic', '/graph', '/analytics', '/notes'])
    expect((await send('GET', `/api/vaults/${vaultId}${suffix}`)).body).not.toContain(value);
  const updated = await send('PATCH', `${base()}/${secret.id}`, {
    name: 'Rotated',
    kind: 'api-key',
    spaceId,
    agentAccess: 'none',
    requireApproval: true,
    value: 'replacement dummy',
    revision: 1,
    password,
  });
  expect(updated.statusCode, updated.body).toBe(200);
  expect(
    (await send('DELETE', `${base()}/${secret.id}`, { revision: 1, password })).statusCode,
  ).toBe(409);
  expect((await send('DELETE', `/api/vaults/${vaultId}`)).statusCode).toBe(409);
  expect(
    (await send('POST', '/api/account/totp/disable', { password, code: recovery[0] })).statusCode,
  ).toBe(409);
  expect(
    (await send('DELETE', `${base()}/${secret.id}`, { revision: 2, password })).statusCode,
  ).toBe(200);
  expect(
    (await securityCollections(db).secrets.findOne({ _id: new ObjectId(secret.id) }))!.encrypted,
  ).toBeUndefined();
  const events = await db
    .collection<AuditRecord>('secret_audit')
    .find({ ownerId: userId })
    .sort({ seq: 1 })
    .toArray();
  let hash = '0'.repeat(64);
  for (const event of events) {
    expect(event.previousHash).toBe(hash);
    expect(auditHash(event)).toBe(event.hash);
    hash = event.hash;
  }
  expect(events.some((event) => event.action === 'secret.read' && event.outcome === 'denied')).toBe(
    true,
  );
  expect(JSON.stringify(events)).not.toContain(value);
  await send('DELETE', `/api/vaults/${vaultId}`);
  expect(await db.collection('secret_audit').countDocuments({ ownerId: userId })).toBe(
    events.length,
  );
});
async function agentFor(
  secretId: string,
  overrides: Partial<Extract<KnowledgePrincipal, { kind: 'agent' }>> = {},
) {
  let principal: KnowledgePrincipal = {
    kind: 'agent',
    ownerId: userId.toHexString(),
    actorId: 'test-agent',
    vaultIds: [vaultId],
    spaceIds: [spaceId],
    scopes: [`secrets:read:${secretId}`],
    ...overrides,
  };
  const adapter = Fastify();
  const service = createSecretsService(db, ring, createSecurityService(db, ring), () => principal);
  adapter.setErrorHandler((error: { statusCode?: number; message: string }, _req, reply) =>
    reply.code(error.statusCode ?? 500).send({ error: error.message }),
  );
  adapter.post<{ Body: { approvalId?: string } }>('/read', async (req) =>
    service.read(req, vaultId, secretId, {}, req.body.approvalId),
  );
  adapter.get('/list', async (req) => service.list(req, vaultId));
  await adapter.ready();
  return {
    adapter,
    set: (next: Partial<Extract<KnowledgePrincipal, { kind: 'agent' }>>) => {
      principal = { ...principal, ...next } as KnowledgePrincipal;
    },
  };
}
it('requires exact agent and Space grants; approval is deduplicated, expires in ten minutes and is single use under concurrency', async () => {
  await enroll();
  const secret = await create(),
    agent = await agentFor(secret.id);
  try {
    const read = () => agent.adapter.inject({ method: 'POST', url: '/read', payload: {} }),
      first = await read();
    expect(first.json().pending, first.body).toBe(true);
    expect((await read()).json().approvalId).toBe(first.json().approvalId);
    const pending = await securityCollections(db).approvals.findOne({
      _id: new ObjectId(first.json().approvalId),
    });
    expect(pending!.expiresAt.getTime() - pending!.createdAt.getTime()).toBe(600000);
    const approve = await send(
      'POST',
      `/api/security/approvals/${first.json().approvalId}/decision`,
      { approved: true, password },
    );
    expect(approve.statusCode, approve.body).toBe(200);
    const results = await Promise.all([
      agent.adapter.inject({
        method: 'POST',
        url: '/read',
        payload: { approvalId: first.json().approvalId },
      }),
      agent.adapter.inject({
        method: 'POST',
        url: '/read',
        payload: { approvalId: first.json().approvalId },
      }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    expect(results.find((r) => r.statusCode === 200)!.json().value).toBe(value);
    agent.set({ scopes: ['notes:read'] });
    expect((await read()).statusCode).toBe(404);
    expect((await agent.adapter.inject('/list')).json().secrets).toEqual([]);
    agent.set({ scopes: [`secrets:read:${secret.id}`], spaceIds: [] });
    expect((await read()).statusCode).toBe(404);
  } finally {
    await agent.adapter.close();
  }
});
it('revokes stale approvals on secret edits, Space policy changes, expiry and session invalidation', async () => {
  await enroll();
  const secret = await create(),
    agent = await agentFor(secret.id);
  try {
    const pending = (
      await agent.adapter.inject({ method: 'POST', url: '/read', payload: {} })
    ).json();
    await send('POST', `/api/security/approvals/${pending.approvalId}/decision`, {
      approved: true,
      password,
    });
    await db
      .collection('spaces')
      .updateOne({ _id: new ObjectId(spaceId) }, { $inc: { revision: 1 } });
    expect(
      (
        await agent.adapter.inject({
          method: 'POST',
          url: '/read',
          payload: { approvalId: pending.approvalId },
        })
      ).statusCode,
    ).toBe(403);
    const expired = (
      await agent.adapter.inject({ method: 'POST', url: '/read', payload: {} })
    ).json();
    await securityCollections(db).approvals.updateOne(
      { _id: new ObjectId(expired.approvalId) },
      { $set: { expiresAt: new Date(0) } },
    );
    expect(
      (
        await send('POST', `/api/security/approvals/${expired.approvalId}/decision`, {
          approved: true,
          password,
        })
      ).statusCode,
    ).toBe(409);
    const next = (await agent.adapter.inject({ method: 'POST', url: '/read', payload: {} })).json();
    await send('POST', `/api/security/approvals/${next.approvalId}/decision`, {
      approved: true,
      password,
    });
    await collections(db).users.updateOne({ _id: userId }, { $inc: { authVersion: 1 } });
    expect(
      (
        await agent.adapter.inject({
          method: 'POST',
          url: '/read',
          payload: { approvalId: next.approvalId },
        })
      ).statusCode,
    ).toBe(403);
    expect((await send('GET', base())).statusCode).toBe(401);
  } finally {
    await agent.adapter.close();
  }
});
it('fails closed when the audit write fails and rotates keys without exposing or changing values', async () => {
  await enroll();
  const secret = await create();
  const original = db.collection.bind(db);
  const spy = vi.spyOn(db, 'collection').mockImplementation(((name: string, ...rest: unknown[]) => {
    if (name === 'secret_audit') throw new Error('Audit unavailable');
    return Reflect.apply(original, db, [name, ...rest]);
  }) as typeof db.collection);
  const blocked = await send('POST', `${base()}/${secret.id}/access`, { password });
  expect(blocked.statusCode).toBe(500);
  expect(blocked.body).not.toContain(value);
  spy.mockRestore();
  const next = new KeyRing('v2', 'b'.repeat(64), { v1: 'a'.repeat(64) });
  expect((await rotateKeys(db, next)).rewrapped).toBe(2);
  expect(
    (await securityCollections(db).secrets.findOne({ _id: new ObjectId(secret.id) }))!.encrypted!
      .keyId,
  ).toBe('v1');
  expect((await rotateKeys(db, next, true)).rewrapped).toBe(2);
  const doc = (await securityCollections(db).secrets.findOne({ _id: new ObjectId(secret.id) }))!;
  expect(
    new KeyRing('v2', 'b'.repeat(64))
      .decrypt(doc.encrypted!, `secret:${doc.ownerId}:${doc.vaultId}:${doc.spaceId}:${doc._id}`)
      .toString(),
  ).toBe(value);
  expect((await rotateKeys(db, next, true)).rewrapped).toBe(0);
  await expect(initializeSecurityDatabase(db, ring)).rejects.toThrow('key ring');
  await initializeSecurityDatabase(db, new KeyRing('v2', 'b'.repeat(64)));
});
it('retains MFA after password recovery and revokes every old session', async () => {
  await enroll();
  const old = headers.cookie!;
  await send('POST', '/api/auth/forgot-password', { email: 'security@example.com' });
  await vi.waitFor(() =>
    expect(mail.messages.some((message) => message.kind === 'password-reset')).toBe(true),
  );
  const token = /token=([\w-]+)/.exec(
    [...mail.messages].reverse().find((message) => message.kind === 'password-reset')!.text,
  )![1];
  const changed = await send('POST', '/api/auth/reset-password', {
    token,
    password: 'a completely new testing passphrase',
  });
  expect(changed.statusCode, changed.body).toBe(200);
  expect(
    (await send('GET', '/api/auth/me', undefined, { ...headers, cookie: old })).statusCode,
  ).toBe(401);
  expect(
    (
      await send('POST', '/api/auth/login', {
        email: 'security@example.com',
        password: 'a completely new testing passphrase',
      })
    ).json().code,
  ).toBe('TOTP_REQUIRED');
  expect(
    (
      await send('POST', '/api/auth/login', {
        email: 'security@example.com',
        password: 'a completely new testing passphrase',
        code: recovery[0],
      })
    ).statusCode,
  ).toBe(200);
});
it('consumes a recovery code once under concurrent requests and replaces all remaining codes', async () => {
  await enroll();
  const service = createSecurityService(db, ring);
  expect(
    (
      await Promise.all([
        service.consumeFactor(userId, recovery[0]!),
        service.consumeFactor(userId, recovery[0]!),
      ])
    ).sort(),
  ).toEqual([false, true]);
  const replacement = await send('POST', '/api/account/totp/recovery-codes', {
    password,
    code: recovery[1],
  });
  expect(replacement.statusCode, replacement.body).toBe(200);
  expect(await service.consumeFactor(userId, recovery[2]!)).toBe(false);
  const old = headers.cookie!;
  const disabled = await send('POST', '/api/account/totp/disable', {
    password,
    code: replacement.json().recoveryCodes[0],
  });
  expect(disabled.statusCode, disabled.body).toBe(200);
  cookie(disabled);
  expect((await send('GET', '/api/security/status')).json().totpEnabled).toBe(false);
  expect(
    (await send('GET', '/api/auth/me', undefined, { ...headers, cookie: old })).statusCode,
  ).toBe(401);
});
it('denies Personal and per-secret opt-out even to an explicitly scoped agent, invalidates edited approvals, and authenticates payloads', async () => {
  await enroll();
  const secret = await create(),
    agent = await agentFor(secret.id);
  try {
    const read = () => agent.adapter.inject({ method: 'POST', url: '/read', payload: {} });
    const pending = (await read()).json();
    await send('POST', `/api/security/approvals/${pending.approvalId}/decision`, {
      approved: true,
      password,
    });
    const update = {
      name: 'Deploy key',
      kind: 'api-key',
      spaceId,
      agentAccess: 'none',
      requireApproval: true,
      revision: 1,
      password,
    };
    expect((await send('PATCH', `${base()}/${secret.id}`, update)).statusCode).toBe(200);
    expect(
      (await securityCollections(db).approvals.findOne({ _id: new ObjectId(pending.approvalId) }))!
        .state,
    ).toBe('denied');
    expect((await read()).statusCode).toBe(404);
    await send('PATCH', `${base()}/${secret.id}`, { ...update, agentAccess: 'read', revision: 2 });
    await db
      .collection('spaces')
      .updateOne(
        { _id: new ObjectId(spaceId) },
        { $set: { agentAccess: 'none' }, $inc: { revision: 1 } },
      );
    expect((await read()).statusCode).toBe(404);
    await securityCollections(db).secrets.updateOne(
      { _id: new ObjectId(secret.id) },
      { $set: { 'encrypted.tag': 'A'.repeat(22) } },
    );
    const failed = await send('POST', `${base()}/${secret.id}/access`, { password });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain(value);
  } finally {
    await agent.adapter.close();
  }
});
it('isolates secret metadata, plaintext, approvals and audit records between account owners', async () => {
  await enroll();
  const secret = await create();
  const ownerHeaders = headers;
  try {
    headers = {
      ...ownerHeaders,
      cookie: ownerHeaders.cookie!.replace(/; helious_session=[^;]+/, ''),
    };
    await send('POST', '/api/auth/register', {
      name: 'Other owner',
      email: 'other-secrets@example.com',
      password,
    });
    const token = /token=([\w-]+)/.exec(mail.messages.at(-1)!.text)![1];
    await send('POST', '/api/auth/verify-email', { token });
    cookie(await send('POST', '/api/auth/login', { email: 'other-secrets@example.com', password }));
    await enroll();
    expect((await send('GET', base())).statusCode).toBe(404);
    expect((await send('POST', `${base()}/${secret.id}/access`, { password })).statusCode).toBe(
      404,
    );
    const events = (await send('GET', '/api/security/audit')).json().events;
    expect(
      events.every((event: { actor: { id: string } }) => event.actor.id !== userId.toHexString()),
    ).toBe(true);
    expect((await send('GET', '/api/security/approvals')).json().approvals).toEqual([]);
  } finally {
    headers = ownerHeaders;
  }
});
