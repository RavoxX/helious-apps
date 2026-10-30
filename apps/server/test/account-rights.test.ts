import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { unzipSync, strFromU8 } from 'fflate';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryEmailService } from '../src/email.js';
import { collections } from '../src/db.js';
import { vaultCollections } from '../src/vault-db.js';
import { processAccountDeletions } from '../src/account-rights.js';
import { SECURITY_EVENT_RETENTION_MS } from '../src/security-events.js';
const origin = 'http://localhost:3000',
  password = 'a private account rights testing phrase';
let mongo: MongoMemoryReplSet,
  client: MongoClient,
  db: Db,
  app: FastifyInstance,
  mail: MemoryEmailService;
type Headers = Record<string, string>;
const req = (headers: Headers, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, headers, ...(method !== 'GET' ? { payload: payload ?? {} } : {}) });
async function csrf() {
  const r = await app.inject('/api/auth/csrf');
  return {
    origin,
    'content-type': 'application/json',
    'x-csrf-token': r.json().csrfToken,
    cookie: `helious_csrf=${r.cookies.find((c) => c.name === 'helious_csrf')!.value}`,
  };
}
async function account(email: string, extra: Record<string, unknown> = {}) {
  const headers = await csrf();
  const registered = await req(headers, 'POST', '/api/auth/register', {
    email,
    password,
    name: 'Account tester',
    ageConfirmed: true,
    ...extra,
  });
  expect(registered.statusCode).toBe(201);
  await req(headers, 'POST', '/api/auth/verify-email', {
    token: /token=([\w-]+)/.exec(mail.messages.at(-1)!.text)![1],
  });
  const login = await req(headers, 'POST', '/api/auth/login', { email, password });
  expect(login.statusCode).toBe(200);
  headers.cookie += `; helious_session=${login.cookies.find((c) => c.name === 'helious_session')!.value}`;
  return { headers, id: new ObjectId(login.json().user.id), email };
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '7.0.24' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('account-rights');
});
beforeEach(async () => {
  await db.dropDatabase();
  mail = new MemoryEmailService();
  app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
      PUBLIC_URL: origin,
      COOKIE_SECURE: 'false',
      REGISTRATION_MIN_AGE: '18',
    }),
    db,
    { staticFiles: false, emailService: mail },
  );
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await client.close();
  await mongo.stop();
});
it('stores minimal security events with a 14-day TTL and excludes URLs, emails and passwords', async () => {
  const headers = await csrf();
  await req(headers, 'POST', '/api/auth/login?token=do-not-log-token', {
    email: 'do-not-log@example.test',
    password: 'do-not-log-password',
  });
  const events = await db.collection('security_events').find({}).toArray();
  expect(events).toHaveLength(1);
  const event = events[0]!;
  expect(event.route).toBe('/api/auth/login');
  expect(event.expiresAt.getTime() - event.at.getTime()).toBe(SECURITY_EVENT_RETENTION_MS);
  expect(JSON.stringify(events)).not.toMatch(/do-not-log|password|email|token=/);
  expect(
    (await db.collection('security_events').listIndexes().toArray()).find(
      (i) => i.name === 'expiresAt_1',
    )?.expireAfterSeconds,
  ).toBe(0);
});

it('requires an explicit adult self-declaration, stores a timestamp and collects no DOB', async () => {
  const headers = await csrf();
  for (const ageConfirmed of [undefined, false])
    expect(
      (
        await req(headers, 'POST', '/api/auth/register', {
          email: 'age@example.test',
          name: 'Age',
          password,
          ...(ageConfirmed === undefined ? {} : { ageConfirmed }),
        })
      ).statusCode,
    ).toBe(400);
  expect(await collections(db).users.countDocuments()).toBe(0);
  const owner = await account('adult@example.test');
  const stored = await collections(db).users.findOne({ _id: owner.id });
  expect(stored?.policyAcceptance).toMatchObject({
    minimumAge: 18,
    ageSelfDeclared: true,
    acceptedAt: expect.any(Date),
  });
  expect(stored).not.toHaveProperty('dateOfBirth');
});
it('requires current versioned terms independently of email verification and age', async () => {
  await app.close();
  app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
      PUBLIC_URL: origin,
      COOKIE_SECURE: 'false',
      REGISTRATION_MIN_AGE: '18',
      TERMS_VERSION: '2026-10-30',
      TERMS_URL: '/legal/terms',
      PRIVACY_URL: '/legal/privacy',
    }),
    db,
    { staticFiles: false, emailService: mail },
  );
  const headers = await csrf(),
    body = { email: 'terms@example.test', name: 'Terms', password, ageConfirmed: true };
  expect((await req(headers, 'POST', '/api/auth/register', body)).statusCode).toBe(400);
  expect(
    (
      await req(headers, 'POST', '/api/auth/register', {
        ...body,
        termsAccepted: true,
        termsVersion: 'old',
      })
    ).statusCode,
  ).toBe(400);
  const owner = await account('terms@example.test', {
    termsAccepted: true,
    termsVersion: '2026-10-30',
  });
  expect(
    (await collections(db).users.findOne({ _id: owner.id }))?.policyAcceptance?.termsVersion,
  ).toBe('2026-10-30');
});
it('exports real files and safe metadata, scopes a single-use download to the same account/session and excludes credentials', async () => {
  const owner = await account('export@example.test'),
    other = await account('other@example.test');
  const vault = (await req(owner.headers, 'POST', '/api/vaults', { name: 'Export vault' })).json()
    .vault;
  const note = await req(owner.headers, 'POST', `/api/vaults/${vault.id}/notes`, {
    path: 'Folder/Note.md',
    markdown: '# My private note\n[[Another]]',
  });
  expect(note.statusCode).toBe(201);
  await req(other.headers, 'POST', '/api/vaults', { name: 'Other owner must stay out' });
  const store = vaultCollections(db),
    fileId = new ObjectId();
  await new Promise<void>((resolve, reject) => {
    const stream = store.bucket.openUploadStreamWithId(fileId, 'image.bin', {
      metadata: { ownerId: owner.id, vaultId: new ObjectId(vault.id) },
    });
    stream.on('error', reject).on('finish', resolve);
    stream.end(Buffer.from([0, 1, 2, 255]));
  });
  await store.attachments.insertOne({
    _id: fileId,
    ownerId: owner.id,
    vaultId: new ObjectId(vault.id),
    path: 'image.bin',
    pathKey: 'image.bin',
    size: 4,
    mimeType: 'application/octet-stream',
    state: 'ready',
    createdAt: new Date(),
  });
  await db.collection('secrets').insertOne({
    ownerId: owner.id,
    name: 'Deploy key',
    encrypted: { value: 'NEVER-EXPORT-SECRET-CIPHERTEXT' },
    state: 'active',
  });
  expect(
    (await req(owner.headers, 'POST', '/api/account/export', { password: 'incorrect' })).statusCode,
  ).toBe(403);
  const grant = await req(owner.headers, 'POST', '/api/account/export', { password });
  expect(grant.statusCode).toBe(200);
  expect((await req(other.headers, 'GET', grant.json().url)).statusCode).toBe(404);
  const response = await req(owner.headers, 'GET', grant.json().url);
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('application/zip');
  const entries = unzipSync(response.rawPayload);
  expect(strFromU8(entries[`vaults/${vault.id}/files/Folder/Note.md`]!)).toContain(
    'My private note',
  );
  expect([...entries[`vaults/${vault.id}/files/image.bin`]!]).toEqual([0, 1, 2, 255]);
  const texts = Object.entries(entries)
    .filter(([name]) => name.endsWith('.json') || name.endsWith('.ndjson'))
    .map(([, bytes]) => strFromU8(bytes))
    .join('\n');
  expect(texts).not.toContain('Other owner must stay out');
  expect(texts).not.toContain('passwordHash');
  expect(texts).not.toContain('tokenHash');
  expect(texts).not.toContain('NEVER-EXPORT-SECRET');
  expect(texts).not.toContain('$argon2');
  expect((await req(owner.headers, 'GET', grant.json().url)).statusCode).toBe(404);
});
it('immediately revokes deletion access and idempotently erases data while preserving other accounts and the last admin', async () => {
  const admin = await account('admin@example.test'),
    owner = await account('delete@example.test');
  const blocked = await req(admin.headers, 'POST', '/api/account/delete', {
    password,
    confirmation: `DELETE ${admin.email}`,
  });
  expect(blocked.statusCode).toBe(409);
  const vault = (await req(owner.headers, 'POST', '/api/vaults', { name: 'Erase me' })).json()
    .vault;
  await req(owner.headers, 'POST', `/api/vaults/${vault.id}/notes`, {
    path: 'Erase.md',
    markdown: 'Erase this content',
  });
  const fileId = new ObjectId();
  const bucket = vaultCollections(db).bucket;
  await new Promise<void>((resolve, reject) => {
    const upload = bucket.openUploadStreamWithId(fileId, 'erase.bin', {
      metadata: { ownerId: owner.id, vaultId: new ObjectId(vault.id) },
    });
    upload.on('error', reject).on('finish', resolve);
    upload.end(Buffer.from('erase attachment'));
  });
  const wrong = await req(owner.headers, 'POST', '/api/account/delete', {
    password,
    confirmation: 'DELETE wrong@example.test',
  });
  expect(wrong.statusCode).toBe(400);
  const deleted = await req(owner.headers, 'POST', '/api/account/delete', {
    password,
    confirmation: `DELETE ${owner.email}`,
  });
  expect(deleted.statusCode).toBe(202);
  expect((await req(owner.headers, 'GET', '/api/auth/me')).statusCode).toBe(401);
  expect(
    (await req(await csrf(), 'POST', '/api/auth/login', { email: owner.email, password }))
      .statusCode,
  ).toBe(401);
  expect(await collections(db).sessions.countDocuments({ userId: owner.id })).toBe(0);
  await db
    .collection('account_deletions')
    .updateOne({ _id: owner.id }, { $set: { notBefore: new Date(0) } });
  await processAccountDeletions(db);
  await processAccountDeletions(db);
  for (const collection of [
    'notes',
    'note_versions',
    'spaces',
    'vaults',
    'secrets',
    'agent_tokens',
  ])
    expect(await db.collection(collection).countDocuments({ ownerId: owner.id })).toBe(0);
  expect(await collections(db).users.findOne({ _id: owner.id })).toBeNull();
  expect(await collections(db).users.findOne({ _id: admin.id })).not.toBeNull();
  expect(await db.collection('attachments.files').countDocuments({ _id: fileId })).toBe(0);
  expect(await db.collection('attachments.chunks').countDocuments({ files_id: fileId })).toBe(0);
  expect((await db.collection('account_deletions').findOne({ _id: owner.id }))?.state).toBe(
    'complete',
  );
});
it('expires and replaces export grants, and requires a fresh factor for MFA-protected exports', async () => {
  const owner = await account('grant@example.test');
  const first = await req(owner.headers, 'POST', '/api/account/export', { password });
  const second = await req(owner.headers, 'POST', '/api/account/export', { password });
  expect((await req(owner.headers, 'GET', first.json().url)).statusCode).toBe(404);
  await db
    .collection('account_exports')
    .updateMany({ userId: owner.id }, { $set: { expiresAt: new Date(0) } });
  expect((await req(owner.headers, 'GET', second.json().url)).statusCode).toBe(404);
  await collections(db).users.updateOne({ _id: owner.id }, { $set: { totpEnabled: true } });
  await collections(db).sessions.updateMany(
    { userId: owner.id },
    { $set: { mfaVerifiedAt: new Date() } },
  );
  expect((await req(owner.headers, 'POST', '/api/account/export', { password })).statusCode).toBe(
    403,
  );
});
it('corrects only the signed-in profile and serializes concurrent administrator deletions', async () => {
  const one = await account('one@example.test'),
    two = await account('two@example.test');
  expect(
    (
      await req(two.headers, 'PATCH', '/api/account/profile', {
        name: 'Corrected name',
        userId: one.id.toHexString(),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await req(two.headers, 'PATCH', '/api/account/profile', { name: 'Corrected name' }))
      .statusCode,
  ).toBe(200);
  expect((await collections(db).users.findOne({ _id: one.id }))?.name).toBe('Account tester');
  await collections(db).users.updateOne({ _id: two.id }, { $set: { role: 'admin' } });
  const results = await Promise.all(
    [one, two].map((owner) =>
      req(owner.headers, 'POST', '/api/account/delete', {
        password,
        confirmation: `DELETE ${owner.email}`,
      }),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([202, 409]);
});
