import { beforeAll, beforeEach, afterEach, afterAll, it, expect } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryEmailService } from '../src/email.js';
import type { SyncFile } from '@helious/core';
let mongo: MongoMemoryReplSet,
  client: MongoClient,
  db: Db,
  app: FastifyInstance,
  headers: Record<string, string>,
  vaultId: string,
  code: string,
  personal: string;
const origin = 'http://localhost:3000',
  password = 'a private sync testing passphrase';
const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, headers, ...(method !== 'GET' ? { payload: body ?? {} } : {}) });
async function login(email: string) {
  const mail = new MemoryEmailService();
  await app.close();
  app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      REGISTRATION_MIN_AGE: '0',
      PUBLIC_URL: origin,
      COOKIE_SECURE: 'false',
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
    }),
    db,
    { emailService: mail, staticFiles: false },
  );
  const csrf = await app.inject('/api/auth/csrf');
  headers = {
    origin,
    'content-type': 'application/json',
    'x-csrf-token': csrf.json().csrfToken,
    cookie: `helious_csrf=${csrf.cookies.find((c) => c.name === 'helious_csrf')!.value}`,
  };
  await request('POST', '/api/auth/register', { email, password, name: 'Sync owner' });
  await request('POST', '/api/auth/verify-email', {
    token: /token=([\w-]+)/.exec(mail.messages.at(-1)!.text)![1],
  });
  const logged = await request('POST', '/api/auth/login', { email, password });
  headers.cookie += `; helious_session=${logged.cookies.find((c) => c.name === 'helious_session')!.value}`;
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '7.0.24' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('sync-tests');
});
beforeEach(async () => {
  await db.dropDatabase();
  app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      REGISTRATION_MIN_AGE: '0',
      PUBLIC_URL: origin,
      COOKIE_SECURE: 'false',
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
    }),
    db,
    { emailService: new MemoryEmailService(), staticFiles: false },
  );
  await login('sync@example.com');
  vaultId = (await request('POST', '/api/vaults', { name: 'Synced vault' })).json().vault.id;
  const spaces = (await request('GET', `/api/vaults/${vaultId}/spaces`)).json().spaces;
  code = spaces.find((s: { name: string }) => s.name === 'Code').id;
  personal = spaces.find((s: { name: string }) => s.name === 'Personal').id;
});
afterEach(() => app.close());
afterAll(async () => {
  await client.close();
  await mongo.stop();
});
const manifest = (spaces = [code]) =>
  request('GET', `/api/vaults/${vaultId}/sync/manifest?spaceIds=${spaces.join(',')}`);
async function save(
  path: string,
  text: string | null,
  expected: SyncFile | null = null,
  kind = 'note',
  spaceId = code,
) {
  return request('POST', `/api/vaults/${vaultId}/sync/file`, {
    path,
    kind,
    spaceId,
    expected,
    data: text === null ? null : Buffer.from(text).toString('base64'),
  });
}
it('versions synced notes, retains empty files, enforces hashes and revisions, and serializes competing writes', async () => {
  const created = await save('Architecture.md', '# Architecture');
  expect(created.statusCode, created.body).toBe(200);
  let file = created.json().file as SyncFile;
  expect(file.hash).toBe(createHash('sha256').update('# Architecture').digest('hex'));
  const results = await Promise.all([
    save(file.path, '# First', file),
    save(file.path, '# Second', file),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  file = results.find((r) => r.statusCode === 200)!.json().file;
  const empty = await save(file.path, '', file);
  expect(empty.statusCode, empty.body).toBe(200);
  file = empty.json().file;
  const read = await request('GET', `/api/vaults/${vaultId}/sync/file?id=${file.id}&kind=note`);
  expect(read.json().data).toBe('');
  expect(read.json().file.hash).toBe(createHash('sha256').update('').digest('hex'));
  expect(
    (await request('GET', `/api/vaults/${vaultId}/notes/${file.id}/history`)).json().versions
      .length,
  ).toBe(3);
  expect((await save(file.path, null, file)).statusCode).toBe(200);
  expect((await manifest()).json().files).toHaveLength(0);
  expect((await request('GET', `/api/vaults/${vaultId}/deleted-notes`)).json().notes).toHaveLength(
    1,
  );
});
it('round-trips binary attachments, rejects stale replacements, and removes superseded GridFS data', async () => {
  const bytes = Buffer.from([0, 1, 2, 255, 0, 128]);
  const created = await request('POST', `/api/vaults/${vaultId}/sync/file`, {
    path: 'Attachments/file.bin',
    kind: 'attachment',
    spaceId: code,
    expected: null,
    data: bytes.toString('base64'),
  });
  expect(created.statusCode, created.body).toBe(200);
  const file = created.json().file;
  const read = await request(
    'GET',
    `/api/vaults/${vaultId}/sync/file?id=${file.id}&kind=attachment`,
  );
  expect(Buffer.from(read.json().data, 'base64')).toEqual(bytes);
  const next = await save(file.path, 'updated attachment', file, 'attachment');
  expect(next.statusCode, next.body).toBe(200);
  expect((await save(file.path, 'stale', file, 'attachment')).statusCode).toBe(409);
  expect(await db.collection('attachments.files').countDocuments({})).toBe(1);
  expect((await save(file.path, null, next.json().file, 'attachment')).statusCode).toBe(200);
  expect(await db.collection('attachments.files').countDocuments({})).toBe(0);
});
it('requires explicit Spaces, never includes secrets and isolates other owners and bearer-only agents', async () => {
  await save('Code.md', 'public code');
  await save('Private.md', 'personal content', null, 'note', personal);
  await db.collection('secrets').insertOne({
    ownerId: new ObjectId(),
    name: 'secret must never sync',
    ciphertext: 'NEVER_INCLUDE',
  });
  expect((await manifest()).json().files.map((f: SyncFile) => f.path)).toEqual(['Code.md']);
  expect((await manifest([personal])).json().files[0].path).toBe('Private.md');
  expect((await manifest([code, personal])).body).not.toContain('NEVER_INCLUDE');
  expect((await request('GET', `/api/vaults/${vaultId}/sync/manifest`)).statusCode).toBe(400);
  expect(
    (
      await app.inject({
        url: `/api/vaults/${vaultId}/sync/manifest?spaceIds=${code}`,
        headers: { authorization: 'Bearer hel_pat_' + 'a'.repeat(43) },
      })
    ).statusCode,
  ).toBe(401);
  const original = headers;
  await login('other-sync@example.com');
  expect((await manifest()).statusCode).toBe(404);
  expect((await save('Code.md', 'other owner')).statusCode).toBe(404);
  headers = original;
});
it('rejects traversal, file-kind collisions, invalid encodings and foreign Space assignments', async () => {
  const spec = (await request('GET', '/api/openapi.json')).json();
  expect(spec.paths['/api/vaults/{vaultId}/sync/file'].post.requestBody).toBeTruthy();
  expect((await save('../Outside.md', 'no')).statusCode).toBe(400);
  expect((await save('No.md', 'bytes', null, 'attachment')).statusCode).toBe(400);
  expect((await save('New.md', 'x', null, 'note', new ObjectId().toHexString())).statusCode).toBe(
    404,
  );
  expect(
    (
      await request('POST', `/api/vaults/${vaultId}/sync/file`, {
        path: 'Invalid.md',
        kind: 'note',
        spaceId: code,
        expected: null,
        data: 'not base64!',
      })
    ).statusCode,
  ).toBe(400);
  const file = (await save('Same.md', 'first')).json().file;
  expect((await save('Same.md', 'another', null)).statusCode).toBe(409);
  expect((await save('Same.md', 'another', { ...file, spaceId: personal })).statusCode).toBe(409);
  expect((await manifest()).json().files[0].hash).toBe(file.hash);
});
