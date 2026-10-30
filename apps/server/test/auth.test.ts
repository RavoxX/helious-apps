import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { collections } from '../src/db.js';
import { hashToken } from '../src/auth.js';
import { MemoryEmailService } from '../src/email.js';
const mail = new MemoryEmailService();

const origin = 'http://localhost:3000';
const config = loadConfig({
  NODE_ENV: 'test',
  REGISTRATION_MIN_AGE: '0',
  HELIOUS_MASTER_KEY: 'a'.repeat(64),
  PUBLIC_URL: origin,
  COOKIE_SECURE: 'false',
});
const account = {
  email: 'reader@example.com',
  name: 'A reader',
  password: 'a private phrase for testing',
};
let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;

function sessionCookie(response: LightMyRequestResponse) {
  const cookie = response.cookies.find((item) => item.name === 'helious_session');
  if (!cookie) throw new Error('Expected session cookie');
  return `helious_session=${cookie.value}`;
}
async function csrfHeaders(session?: string) {
  const response = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  const cookie = response.cookies.find((item) => item.name === 'helious_csrf')!;
  return {
    origin,
    'content-type': 'application/json',
    'x-csrf-token': response.json<{ csrfToken: string }>().csrfToken,
    cookie: [`helious_csrf=${cookie.value}`, session].filter(Boolean).join('; '),
  };
}
async function register(data = account) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: await csrfHeaders(),
    payload: data,
  });
  if (response.statusCode !== 201) return response;
  const message = [...mail.messages]
    .reverse()
    .find((message) => message.to === data.email.toLowerCase())!;
  const token = /token=([\w-]+)/.exec(message.text)![1];
  const verified = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    headers: await csrfHeaders(),
    payload: { token },
  });
  expect(verified.statusCode, verified.body).toBe(200);
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: await csrfHeaders(),
    payload: { email: data.email, password: data.password },
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('helious-tests');
});
beforeEach(async () => {
  await db.dropDatabase();
  mail.messages.length = 0;
  app = await buildApp(config, db, { staticFiles: false, emailService: mail });
  await app.ready();
});
afterEach(async () => {
  await app?.close();
});
afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

describe('account foundation against MongoDB 7', () => {
  it('stores Argon2id passwords and hashed sessions and gives the first account admin', async () => {
    const result = await register({ ...account, email: 'Reader@Example.com' });
    expect(result.statusCode).toBe(200);
    expect(result.json().user).toMatchObject({
      email: account.email,
      role: 'admin',
      name: account.name,
    });
    expect(result.json().user).not.toHaveProperty('passwordHash');
    const store = collections(db);
    const user = await store.users.findOne({ email: account.email });
    expect(user?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    const token = result.cookies.find((item) => item.name === 'helious_session')!.value;
    expect(await store.sessions.findOne({ tokenHash: hashToken(token) })).toBeTruthy();
    expect(JSON.stringify(await store.sessions.findOne({}))).not.toContain(token);
    expect(result.headers['set-cookie']).toEqual(expect.stringContaining('HttpOnly'));
    expect(result.headers['set-cookie']).toEqual(expect.stringContaining('SameSite=Lax'));
    const me = await app.inject({
      url: '/api/auth/me',
      headers: { cookie: sessionCookie(result) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store');
  });

  it('selects exactly one administrator during concurrent registrations', async () => {
    const responses = await Promise.all(
      [0, 1, 2].map((index) => register({ ...account, email: `concurrent${index}@example.com` })),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    expect(await collections(db).users.countDocuments({ role: 'admin' })).toBe(1);
  });

  it('rejects duplicate emails and weak or malformed input', async () => {
    expect((await register()).statusCode).toBe(200);
    expect((await register({ ...account, email: 'READER@example.com' })).statusCode).toBe(409);
    expect((await register({ ...account, password: 'short' })).statusCode).toBe(400);
    expect((await register({ ...account, name: ' ' })).statusCode).toBe(400);
    expect((await register({ ...account, email: 'invalid' })).statusCode).toBe(400);
  });

  it('requires origin, JSON, and a valid signed CSRF token before mutation', async () => {
    const headers = await csrfHeaders();
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/register', payload: account }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers: { ...headers, origin: 'https://evil.example' },
          payload: account,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers: { ...headers, 'x-csrf-token': 'a'.repeat(64) },
          payload: account,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers: { ...headers, 'x-csrf-token': 'é'.repeat(64) },
          payload: account,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers: { ...headers, cookie: headers.cookie.replace(/.$/, 'X') },
          payload: account,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers: { ...headers, 'content-type': 'text/plain' },
          payload: JSON.stringify(account),
        })
      ).statusCode,
    ).toBe(415);
    expect(await collections(db).users.countDocuments()).toBe(0);
  });

  it('signs in and revokes the session on logout', async () => {
    await register();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: await csrfHeaders(),
      payload: { email: account.email, password: account.password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = sessionCookie(login);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: await csrfHeaders(cookie),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('rotates aged session IDs and immediately invalidates the old credential', async () => {
    const registered = await register();
    await collections(db).sessions.updateOne(
      {},
      { $set: { rotatedAt: new Date(Date.now() - 16 * 60 * 1000) } },
    );
    const oldCookie = sessionCookie(registered);
    const response = await app.inject({ url: '/api/auth/me', headers: { cookie: oldCookie } });
    expect(response.statusCode).toBe(200);
    const nextCookie = sessionCookie(response);
    expect(nextCookie).not.toBe(oldCookie);
    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: oldCookie } })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: nextCookie } })).statusCode,
    ).toBe(200);
  });

  it('rejects expired sessions without waiting for TTL cleanup', async () => {
    const response = await register();
    await collections(db).sessions.updateOne(
      {},
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: sessionCookie(response) } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: 'helious_session=malformed' } }))
        .statusCode,
    ).toBe(401);
  });

  it('scopes session listing and revocation to the authenticated account', async () => {
    const first = await register();
    const second = await register({ ...account, email: 'another@example.com' });
    const firstCookie = sessionCookie(first);
    const firstSessions = await app.inject({
      url: '/api/auth/sessions',
      headers: { cookie: firstCookie },
    });
    expect(firstSessions.json().sessions).toHaveLength(1);
    expect(firstSessions.json().sessions[0].current).toBe(true);
    const victim = await collections(db).sessions.findOne({
      userId: { $ne: (await collections(db).users.findOne({ email: account.email }))!._id },
    });
    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${victim!._id.toHexString()}`,
      headers: await csrfHeaders(firstCookie),
      payload: {},
    });
    expect(forbidden.statusCode).toBe(404);
    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: sessionCookie(second) } }))
        .statusCode,
    ).toBe(200);
    const ownId = firstSessions.json().sessions[0].id as string;
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/auth/sessions/${ownId}`,
          headers: await csrfHeaders(firstCookie),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: firstCookie } })).statusCode,
    ).toBe(401);
  });

  it('locks out after five bad passwords and gives the same error for missing accounts', async () => {
    await register();
    let previous = '';
    for (let i = 0; i < 5; i++) {
      const bad = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: await csrfHeaders(),
        payload: { email: account.email, password: 'the wrong password entirely' },
      });
      expect(bad.statusCode).toBe(401);
      previous = bad.body;
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: await csrfHeaders(),
      payload: { email: account.email, password: account.password },
    });
    expect(blocked.statusCode).toBe(429);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: await csrfHeaders(),
      payload: { email: 'missing@example.com', password: account.password },
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.body).toBe(previous);
  });

  it('uses an IP limit even for credential attempts spread across accounts', async () => {
    const headers = await csrfHeaders();
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers,
        payload: { email: 'invalid', password: 'invalid' },
      });
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers,
          payload: { email: account.email, password: account.password },
        })
      ).statusCode,
    ).toBe(429);
  });

  it('only lets the admin toggle registration and enforces closed registration', async () => {
    const admin = await register();
    const normal = await register({ ...account, email: 'normal@example.com' });
    const rejected = await app.inject({
      method: 'PUT',
      url: '/api/admin/registration',
      headers: await csrfHeaders(sessionCookie(normal)),
      payload: { open: false },
    });
    expect(rejected.statusCode).toBe(403);
    const accepted = await app.inject({
      method: 'PUT',
      url: '/api/admin/registration',
      headers: await csrfHeaders(sessionCookie(admin)),
      payload: { open: false },
    });
    expect(accepted.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/config' })).json()).toEqual({
      registrationOpen: false,
      minimumAge: 0,
      terms: null,
      privacyUrl: null,
    });
    expect((await register({ ...account, email: 'late@example.com' })).statusCode).toBe(403);
  });

  it('exports OpenAPI, sets headers, checks readiness, and exposes no future endpoint', async () => {
    const health = await app.inject({ url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['content-security-policy']).toContain("script-src 'self'");
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers).not.toHaveProperty('access-control-allow-origin');
    const schema = await app.inject({ url: '/api/openapi.json' });
    expect(schema.json().paths).toHaveProperty('/api/auth/register');
    expect(
      (await app.inject({ url: '/mcp', headers: { host: 'localhost:3000' } })).statusCode,
    ).toBe(401);
    const indexes = await collections(db).sessions.listIndexes().toArray();
    expect(indexes.find((index) => index.name === 'expiresAt_1')?.expireAfterSeconds).toBe(0);
  });

  it('uses Secure cookies when configured for an HTTPS deployment', async () => {
    await app.close();
    app = await buildApp(
      loadConfig({
        NODE_ENV: 'production',
        HELIOUS_MASTER_KEY: 'b'.repeat(64),
        PUBLIC_URL: 'https://knowledge.example.com',
        RESEND_API_KEY: 're_test_placeholder',
        EMAIL_FROM: 'Helious <test@example.com>',
      }),
      db,
      { staticFiles: false, emailService: mail },
    );
    const response = await app.inject({ url: '/api/auth/csrf' });
    expect(response.headers['set-cookie']).toEqual(expect.stringContaining('Secure'));
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
  });
  it('does not spend the API rate budget on page and asset requests', async () => {
    for (let i = 0; i < 310; i++) {
      const result = await app.inject({ url: `/landing-assets/example-${i}.js` });
      expect(result.statusCode).toBe(404);
    }
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
  });
});
