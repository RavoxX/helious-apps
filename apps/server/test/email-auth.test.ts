import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryEmailService } from '../src/email.js';
import { EmailTokens, EMAIL_TOKEN_MS, emailTokenHash, newEmailToken } from '../src/email-tokens.js';
import { migrateVerifiedAccounts } from '../src/migrations.js';
import { EmailNotifications } from '../src/email-notifications.js';

const origin = 'http://localhost:3000';
const credentials = {
  email: 'reader@example.com',
  password: 'a private testing passphrase',
  name: 'Reader',
};
const config = loadConfig({
  NODE_ENV: 'test',
  HELIOUS_MASTER_KEY: 'a'.repeat(64),
  PUBLIC_URL: origin,
  COOKIE_SECURE: 'false',
});
let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;
let mail: MemoryEmailService;
let headers: Record<string, string>;
const post = (path: string, body: unknown, extra = {}) =>
  app.inject({
    method: 'POST',
    url: path,
    headers: { ...headers, ...extra },
    payload: body as Record<string, unknown>,
  });
const latestToken = (kind = 'verification') =>
  /token=([\w-]+)/.exec(
    [...mail.messages].reverse().find((message) => message.kind === kind)!.text,
  )![1]!;
async function registerVerified() {
  expect((await post('/api/auth/register', credentials)).statusCode).toBe(201);
  expect((await post('/api/auth/verify-email', { token: latestToken() })).statusCode).toBe(200);
  const response = await post('/api/auth/login', credentials);
  return `helious_session=${response.cookies.find((cookie) => cookie.name === 'helious_session')!.value}`;
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('email-auth-tests');
});
beforeEach(async () => {
  await db.dropDatabase();
  mail = new MemoryEmailService();
  app = await buildApp(config, db, { staticFiles: false, emailService: mail });
  await app.ready();
  const csrf = await app.inject('/api/auth/csrf');
  headers = {
    origin,
    'content-type': 'application/json',
    'x-csrf-token': csrf.json().csrfToken,
    cookie: `helious_csrf=${csrf.cookies[0]!.value}`,
  };
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await client.close();
  await mongo.stop();
});

it('creates 256-bit URL-safe tokens, stores hashes only and expires at exactly 30 minutes', async () => {
  const now = new Date();
  const value = newEmailToken(now);
  expect(value.token).toMatch(/^[\w-]{43}$/);
  expect(Buffer.from(value.token, 'base64url')).toHaveLength(32);
  expect(value.hash).toBe(emailTokenHash(value.token));
  expect(value.expiresAt.getTime() - now.getTime()).toBe(EMAIL_TOKEN_MS);
  const tokens = new EmailTokens(db);
  const issued = await tokens.issue(new ObjectId(), 'verify-email', undefined, now);
  expect(JSON.stringify(await db.collection('email_tokens').findOne({}))).not.toContain(
    issued.token,
  );
  expect(
    await tokens.consume(issued.token, ['verify-email'], new Date(now.getTime() + EMAIL_TOKEN_MS)),
  ).toBeNull();
  const indexes = await db.collection('email_tokens').listIndexes().toArray();
  expect(indexes.find((index) => index.name === 'expiresAt_1')?.expireAfterSeconds).toBe(0);
});
it('consumes once atomically, separates token purposes and invalidates old tokens on re-request', async () => {
  const tokens = new EmailTokens(db);
  const user = new ObjectId();
  const first = await tokens.issue(user, 'verify-email');
  const next = await tokens.issue(user, 'verify-email');
  expect(await tokens.consume(first.token, ['verify-email'])).toBeNull();
  expect(await tokens.consume(next.token, ['reset-password'])).toBeNull();
  const raced = await Promise.all([
    tokens.consume(next.token, ['verify-email']),
    tokens.consume(next.token, ['verify-email']),
  ]);
  expect(raced.filter(Boolean)).toHaveLength(1);
  expect((await db.collection('email_tokens').findOne({}))?.usedAt).toBeInstanceOf(Date);
});
it('limits concurrent email requests to three per normalized address in a rolling 15-minute window', async () => {
  const tokens = new EmailTokens(db);
  const now = new Date();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => tokens.allowEmail('Reader@example.com', now)),
  );
  expect(results.filter(Boolean)).toHaveLength(3);
  expect(
    await tokens.allowEmail('reader@example.com', new Date(now.getTime() + 14 * 60 * 1000)),
  ).toBe(false);
  expect(
    await tokens.allowEmail('reader@example.com', new Date(now.getTime() + 15 * 60 * 1000)),
  ).toBe(true);
});
it('queues security notifications when the three-email allowance is full and delivers after it reopens', async () => {
  const rates = new EmailTokens(db);
  const notices = new EmailNotifications(db, mail, () => {});
  const now = new Date();
  await Promise.all([
    rates.allowEmail(credentials.email, now),
    rates.allowEmail(credentials.email, now),
    rates.allowEmail(credentials.email, now),
  ]);
  expect(
    await notices.send(credentials.email, 'password-changed', `${origin}/app/?mode=login`),
  ).toBe(true);
  expect(mail.messages).toHaveLength(0);
  expect(await db.collection('email_notifications').countDocuments()).toBe(1);
  await notices.flush(new Date(now.getTime() + 15 * 60 * 1000 + 1000));
  expect(mail.messages).toHaveLength(1);
  expect(mail.messages[0]!.kind).toBe('password-changed');
  expect(await db.collection('email_notifications').countDocuments()).toBe(0);
});

it('retains failed security notifications and retries without exposing provider errors', async () => {
  const failed = vi.fn();
  const notices = new EmailNotifications(db, mail, failed);
  mail.send = async () => {
    throw new Error('private provider detail');
  };
  expect(await notices.send(credentials.email, 'password-changed', `${origin}/app/`)).toBe(false);
  expect(failed).toHaveBeenCalledOnce();
  expect(await db.collection('email_notifications').countDocuments()).toBe(1);
  mail.send = async (message) => {
    mail.messages.push(message);
  };
  await notices.flush(new Date(Date.now() + 61_000));
  expect(mail.messages).toHaveLength(1);
  expect(await db.collection('email_notifications').countDocuments()).toBe(0);
});

it('registers unverified without a session and blocks correct-password login and forged legacy sessions', async () => {
  const response = await post('/api/auth/register', credentials);
  expect(response.statusCode).toBe(201);
  expect(response.cookies.some((cookie) => cookie.name === 'helious_session')).toBe(false);
  const user = await db.collection('users').findOne({ email: credentials.email });
  expect(user?.emailVerified).toBe(false);
  expect((await post('/api/auth/login', credentials)).json()).toMatchObject({
    code: 'EMAIL_UNVERIFIED',
    error: 'Please verify your email',
  });
  await db.collection('sessions').insertOne({
    userId: user!._id,
    tokenHash: emailTokenHash('a'.repeat(64)),
    expiresAt: new Date(Date.now() + 60000),
    rotatedAt: new Date(),
  });
  expect(
    (
      await app.inject({
        url: '/api/vaults',
        headers: { cookie: `helious_session=${'a'.repeat(64)}` },
      })
    ).statusCode,
  ).toBe(403);
  expect((await post('/api/auth/verify-email', { token: latestToken() })).statusCode).toBe(200);
  expect((await post('/api/auth/login', credentials)).statusCode).toBe(200);
  expect((await post('/api/auth/verify-email', { token: latestToken() })).statusCode).toBe(400);
  expect(mail.messages[0]!.html).toContain('Verify email');
  expect(mail.messages[0]!.text).toContain(`${origin}/verify-email?token=`);
});
it('migrates only legacy accounts without locking them out or verifying new accounts', async () => {
  await db.collection('users').insertMany([
    { email: 'legacy@example.com', createdAt: new Date() },
    { email: 'new@example.com', emailVerified: false, authVersion: 0 },
  ]);
  await migrateVerifiedAccounts(db);
  await migrateVerifiedAccounts(db);
  expect(await db.collection('users').findOne({ email: 'legacy@example.com' })).toMatchObject({
    emailVerified: true,
    authVersion: 0,
  });
  expect(await db.collection('users').findOne({ email: 'new@example.com' })).toMatchObject({
    emailVerified: false,
  });
});
it('resets a password, revokes every session and rejects old tokens and old credentials', async () => {
  const session = await registerVerified();
  const another = await post('/api/auth/login', credentials);
  expect(another.statusCode).toBe(200);
  await post('/api/auth/forgot-password', { email: credentials.email });
  await vi.waitFor(() =>
    expect(mail.messages.some((message) => message.kind === 'password-reset')).toBe(true),
  );
  const token = latestToken('password-reset');
  expect(
    (await post('/api/auth/reset-password', { token, password: 'password123456' })).statusCode,
  ).toBe(400);
  const reset = await post('/api/auth/reset-password', {
    token,
    password: 'a different strong phrase',
  });
  expect(reset.statusCode).toBe(200);
  expect(reset.json().message).toContain('agent/MCP');
  expect(await db.collection('sessions').countDocuments()).toBe(0);
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie: session } })).statusCode).toBe(
    401,
  );
  expect(
    (await post('/api/auth/reset-password', { token, password: 'yet another strong phrase' }))
      .statusCode,
  ).toBe(400);
  expect((await post('/api/auth/login', credentials)).statusCode).toBe(401);
  expect(
    (
      await post('/api/auth/login', {
        email: credentials.email,
        password: 'a different strong phrase',
      })
    ).statusCode,
  ).toBe(200);
  expect(mail.messages.some((message) => message.kind === 'password-changed')).toBe(true);
});
it('returns identical neutral reset responses for unknown, known, throttled and failed delivery', async () => {
  await registerVerified();
  const known = await post('/api/auth/forgot-password', { email: credentials.email });
  const unknown = await post('/api/auth/forgot-password', { email: 'unknown@example.com' });
  expect(known.body).toBe(unknown.body);
  expect(known.statusCode).toBe(202);
  mail.send = async () => {
    throw new Error('provider internal secret');
  };
  const failed = await post('/api/auth/forgot-password', { email: credentials.email });
  expect(failed.body).toBe(known.body);
  await post('/api/auth/forgot-password', { email: credentials.email });
  const limited = await post('/api/auth/forgot-password', { email: credentials.email });
  expect(limited.body).toBe(known.body);
});
it('keeps the old email active until the new address is verified, then notifies both addresses', async () => {
  const session = await registerVerified();
  const authHeaders = { cookie: `${headers.cookie}; ${session}` };
  expect(
    (
      await post(
        '/api/account/email',
        { email: 'new@example.com', password: 'wrong password' },
        authHeaders,
      )
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await post(
        '/api/account/email',
        { email: 'new@example.com', password: credentials.password },
        authHeaders,
      )
    ).statusCode,
  ).toBe(200);
  expect((await db.collection('users').findOne({ email: credentials.email }))?.pendingEmail).toBe(
    'new@example.com',
  );
  expect((await post('/api/auth/login', credentials)).statusCode).toBe(200);
  const verified = await post('/api/auth/verify-email', { token: latestToken() });
  expect(verified.statusCode).toBe(200);
  expect((await post('/api/auth/login', credentials)).statusCode).toBe(401);
  expect(
    (await post('/api/auth/login', { email: 'new@example.com', password: credentials.password }))
      .statusCode,
  ).toBe(200);
  expect(
    mail.messages
      .filter((message) => message.kind === 'email-changed')
      .map((message) => message.to),
  ).toEqual(expect.arrayContaining([credentials.email, 'new@example.com']));
});
it('enforces per-IP limits and gives generic delivery errors without provider internals', async () => {
  mail.send = async () => {
    throw new Error('secret-provider-detail');
  };
  const result = await post('/api/auth/register', credentials);
  expect(result.statusCode).toBe(503);
  expect(result.body).not.toContain('secret-provider-detail');
  for (let i = 0; i < 10; i++)
    await post('/api/auth/resend-verification', { email: 'nobody@example.com' });
  expect(
    (await post('/api/auth/resend-verification', { email: 'nobody@example.com' })).statusCode,
  ).toBe(429);
});
