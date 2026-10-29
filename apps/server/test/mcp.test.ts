import { beforeAll, beforeEach, afterAll, afterEach, it, expect } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryEmailService } from '../src/email.js';
import { digest, agentStore } from '../src/agent-tokens.js';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fromBase32, totpCode } from '../src/totp.js';
const origin = 'http://localhost:3000',
  password = 'a project memory testing passphrase',
  email = 'agent-owner@example.com',
  mail = new MemoryEmailService();
let mongo: MongoMemoryReplSet,
  client: MongoClient,
  db: Db,
  app: FastifyInstance,
  headers: Record<string, string>,
  vaultId: string,
  spaceId: string,
  personalId: string,
  raw: string;
const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, headers, ...(method !== 'GET' ? { payload: payload ?? {} } : {}) });
async function note(path: string, markdown: string, space = spaceId) {
  const result = await request('POST', `/api/vaults/${vaultId}/notes`, {
    path,
    markdown,
    spaceId: space,
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json().note as { id: string; revision: number };
}
async function issue(scopes = ['notes:read', 'notes:write'], spaces = [spaceId]) {
  const result = await request('POST', '/api/agents/tokens', {
    name: 'Test coding agent',
    vaultIds: [vaultId],
    spaceIds: spaces,
    scopes,
    password,
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json() as { token: string; metadata: { id: string } };
}
const rpc = (
  method: string,
  params: unknown = {},
  token = raw,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      host: 'localhost:3000',
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
      ...extra,
    },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
async function tool(name: string, args: Record<string, unknown> = {}, token = raw) {
  const result = await rpc('tools/call', { name, arguments: args }, token);
  expect(result.statusCode, result.body).toBe(200);
  return result.json().result as { isError?: boolean; content: { text: string }[] };
}
const data = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '7.0.24' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('mcp-tests');
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
  await request('POST', '/api/auth/register', { email, password, name: 'Agent owner' });
  await request('POST', '/api/auth/verify-email', {
    token: /token=([\w-]+)/.exec(mail.messages.at(-1)!.text)![1],
  });
  const login = await request('POST', '/api/auth/login', { email, password });
  headers.cookie += `; helious_session=${login.cookies.find((c) => c.name === 'helious_session')!.value}`;
  vaultId = (await request('POST', '/api/vaults', { name: 'Project vault' })).json().vault.id;
  const spaces = (await request('GET', `/api/vaults/${vaultId}/spaces`)).json().spaces;
  spaceId = spaces.find((s: { name: string }) => s.name === 'Code').id;
  personalId = spaces.find((s: { name: string }) => s.name === 'Personal').id;
  raw = (await issue()).token;
});
afterEach(() => app.close());
afterAll(async () => {
  await client.close();
  await mongo.stop();
});
it('requires bearer auth, validates origin/host, advertises MCP tools, resources and prompts, and stores hashes only', async () => {
  const unauth = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { host: 'localhost:3000', 'content-type': 'application/json' },
    payload: {},
  });
  expect(unauth.statusCode).toBe(401);
  expect(unauth.headers['www-authenticate']).toContain('oauth-protected-resource/mcp');
  expect((await rpc('tools/list', {}, raw, { origin: 'https://evil.example' })).statusCode).toBe(
    403,
  );
  expect((await rpc('tools/list', {}, raw, { host: 'evil.example' })).statusCode).toBe(403);
  const init = await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  expect(init.json().result.capabilities).toHaveProperty('tools');
  const tools = (await rpc('tools/list')).json().result.tools;
  expect(tools).toHaveLength(17);
  expect(
    tools.find((t: { name: string }) => t.name === 'update_note').inputSchema.required,
  ).toContain('revision');
  expect((await rpc('prompts/list')).json().result.prompts[0].name).toBe('project_context');
  expect(await agentStore(db).findOne({ hash: digest(raw) })).not.toBeNull();
  expect(JSON.stringify(await agentStore(db).find({}).toArray())).not.toContain(raw);
  expect((await request('GET', '/api/agents/tokens')).body).not.toContain(raw);
});
it('keeps Personal notes and references out of search, graph, backlinks, resources and prompts', async () => {
  await note('Private Journal.md', '# Confidential journal\nUnshareable-personal-code', personalId);
  const publicNote = await note(
    'Projects/demo/Architecture.md',
    '---\ntags: [memory]\n---\n# Architecture\n[[Private Journal]]',
  );
  for (const [name, args] of [
    ['search_notes', { query: 'Unshareable-personal-code' }],
    ['get_graph_neighbors', { noteId: publicNote.id, depth: 3 }],
    ['get_backlinks', { noteId: publicNote.id }],
    ['list_tags', {}],
  ] as const) {
    const result = await tool(name, { vaultId, ...args });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).not.toContain('Confidential journal');
    expect(JSON.stringify(result)).not.toContain('Private Journal');
    expect(JSON.stringify(result)).not.toContain('Unshareable');
  }
  const resources = (await rpc('resources/list')).json().result.resources;
  expect(resources).toHaveLength(1);
  expect(resources[0].uri).toContain(spaceId);
  const blocked = await rpc('resources/read', {
    uri: `helious://${vaultId}/${personalId}/Private%20Journal.md`,
  });
  expect(blocked.json()).toHaveProperty('error');
  const prompt = await rpc('prompts/get', {
    name: 'project_context',
    arguments: { vaultId, spaceId, project: 'demo' },
  });
  expect(prompt.body).toContain('UNTRUSTED');
  expect(prompt.body).not.toContain('Confidential journal');
});
it('versions agent writes, rejects stale revisions, supports append/move and records attributed activity', async () => {
  const created = data(
    await tool('create_note', { vaultId, spaceId, path: 'One.md', markdown: '# One' }),
  ).note;
  expect(data(await tool('read_note', { vaultId, noteId: created.id })).note.markdown).toBe(
    '# One',
  );
  expect(
    (await tool('update_note', { vaultId, noteId: created.id, revision: 1, markdown: '# Revised' }))
      .isError,
  ).not.toBe(true);
  expect(
    (await tool('append_to_note', { vaultId, noteId: created.id, revision: 1, markdown: 'stale' }))
      .isError,
  ).toBe(true);
  expect(
    (
      await tool('append_to_note', {
        vaultId,
        noteId: created.id,
        revision: 2,
        markdown: 'Appended memory',
      })
    ).isError,
  ).not.toBe(true);
  expect(
    (await tool('move_note', { vaultId, noteId: created.id, revision: 3, path: 'Folder/Moved.md' }))
      .isError,
  ).not.toBe(true);
  const versions = (
    await request('GET', `/api/vaults/${vaultId}/notes/${created.id}/history`)
  ).json().versions;
  expect(versions.every((v: { actor: { kind: string } }) => v.actor.kind === 'agent')).toBe(true);
  expect(versions[0].actor.id).toBe(
    (await agentStore(db).findOne({ hash: digest(raw) }))!._id.toHexString(),
  );
  const analytics = (await request('GET', `/api/vaults/${vaultId}/analytics`)).json();
  expect(analytics.agentActivityAvailable).toBe(true);
  expect(analytics.agentActivity.some((a: { action: string }) => a.action === 'write')).toBe(true);
});
it('supports project templates, durable remember/recall, daily notes and resource reads without silent overwrite', async () => {
  const template = await request('POST', `/api/vaults/${vaultId}/project-template`, {
    spaceId,
    project: 'demo',
  });
  expect(template.statusCode, template.body).toBe(200);
  expect(template.json().created).toHaveLength(5);
  expect(
    (await request('POST', `/api/vaults/${vaultId}/project-template`, { spaceId, project: 'demo' }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await tool('remember', {
        vaultId,
        spaceId,
        project: 'demo',
        entry: 'We chose a worker for graph layout.',
      })
    ).isError,
  ).not.toBe(true);
  const recalled = data(
    await tool('recall', { vaultId, spaceId, query: 'worker', project: 'demo', limit: 10 }),
  );
  expect(recalled.mode).toBe('keyword');
  expect(recalled.results).toHaveLength(1);
  const resource = (await rpc('resources/list'))
    .json()
    .result.resources.find((r: { uri: string }) => r.uri.includes('Agent%20Log.md'));
  expect((await rpc('resources/read', { uri: resource.uri })).body).toContain('Test coding agent');
  const daily = await tool('get_daily_note', {
    vaultId,
    spaceId,
    date: '2026-10-29',
    create: true,
  });
  expect(data(daily).note.path).toBe('Daily/2026-10-29.md');
  expect(
    (await tool('list_folder', { vaultId, spaceId, path: 'Daily', offset: 0, limit: 50 })).isError,
  ).not.toBe(true);
});
it('requires explicit scopes and Personal consent; revocation, expiry and account changes immediately block requests', async () => {
  expect(
    (
      await request('POST', '/api/agents/tokens', {
        name: 'Private',
        vaultIds: [vaultId],
        spaceIds: [personalId],
        scopes: ['notes:read'],
        password,
      })
    ).statusCode,
  ).toBe(400);
  const reader = await issue(['notes:read']);
  expect(
    (
      await tool(
        'create_note',
        { vaultId, spaceId, path: 'Forbidden.md', markdown: 'x' },
        reader.token,
      )
    ).isError,
  ).toBe(true);
  await request('DELETE', `/api/agents/tokens/${reader.metadata.id}`);
  expect((await rpc('tools/list', {}, reader.token)).statusCode).toBe(401);
  await agentStore(db).updateOne({ hash: digest(raw) }, { $set: { expiresAt: new Date(0) } });
  expect((await rpc('tools/list')).statusCode).toBe(401);
  const current = await issue(['notes:read']);
  await db.collection('users').updateOne({ email }, { $inc: { authVersion: 1 } });
  expect((await rpc('tools/list', {}, current.token)).statusCode).toBe(401);
});
it('requires an exact secret scope and preserves single-use approvals over real MCP', async () => {
  const setup = await request('POST', '/api/account/totp/setup', { password });
  const enabled = await request('POST', '/api/account/totp/enable', {
    code: totpCode(fromBase32(setup.json().secret), Math.floor(Date.now() / 30000)),
  });
  headers.cookie =
    headers.cookie!.replace(/; helious_session=[^;]+/, '') +
    `; helious_session=${enabled.cookies.find((c) => c.name === 'helious_session')!.value}`;
  const secret = (
    await request('POST', `/api/vaults/${vaultId}/secrets`, {
      name: 'Synthetic deploy key',
      kind: 'api-key',
      spaceId,
      agentAccess: 'read',
      requireApproval: true,
      value: 'dummy-not-real',
      password,
    })
  ).json().secret;
  raw = (await issue([`secrets:read:${secret.id}`])).token;
  const pending = data(await tool('get_secret', { vaultId, secretId: secret.id }));
  expect(pending.pending).toBe(true);
  expect((await tool('list_secrets', { vaultId })).isError).not.toBe(true);
  await request('POST', `/api/security/approvals/${pending.approvalId}/decision`, {
    approved: true,
    password,
  });
  expect(
    data(await tool('get_secret', { vaultId, secretId: secret.id, approvalId: pending.approvalId }))
      .value,
  ).toBe('dummy-not-real');
  expect(
    (await tool('get_secret', { vaultId, secretId: secret.id, approvalId: pending.approvalId }))
      .isError,
  ).toBe(true);
});
const verifier = 'a'.repeat(64),
  challenge = createHash('sha256').update(verifier).digest('base64url');
async function oauthRequest() {
  const client = await app.inject({
    method: 'POST',
    url: '/oauth/register',
    headers: { 'content-type': 'application/json' },
    payload: {
      client_name: 'Example AI client',
      redirect_uris: ['http://127.0.0.1:4567/callback'],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(client.statusCode, client.body).toBe(201);
  const params = {
    response_type: 'code',
    client_id: client.json().client_id,
    redirect_uri: 'http://127.0.0.1:4567/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'notes:read notes:write',
    state: 'client-csrf-state',
    resource: origin + '/mcp',
  };
  const authorize = await app.inject('/oauth/authorize?' + new URLSearchParams(params));
  expect(authorize.statusCode, authorize.body).toBe(302);
  const pending = new URL(String(authorize.headers.location), origin).searchParams.get('request')!;
  const consent = await request('GET', '/api/oauth/requests/' + pending);
  expect(consent.statusCode, consent.body).toBe(200);
  return { clientId: client.json().client_id as string, params, pending };
}
async function approve() {
  const flow = await oauthRequest();
  const consent = await request('POST', '/api/oauth/consent', {
    request: flow.pending,
    approved: true,
    vaultIds: [vaultId],
    spaceIds: [spaceId],
    scopes: ['notes:read', 'notes:write'],
  });
  expect(consent.statusCode, consent.body).toBe(200);
  const redirect = new URL(consent.json().redirect);
  expect(redirect.searchParams.get('state')).toBe('client-csrf-state');
  return { ...flow, code: redirect.searchParams.get('code')! };
}
const exchange = (body: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ resource: origin + '/mcp', ...body }).toString(),
  });
it('supports OAuth discovery, exact redirect matching, browser consent, S256 and single-use authorization codes', async () => {
  const metadata = (await app.inject('/.well-known/oauth-authorization-server')).json();
  expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
  expect((await app.inject('/.well-known/oauth-protected-resource/mcp')).json().resource).toBe(
    origin + '/mcp',
  );
  const flow = await approve();
  expect(
    (
      await app.inject(
        '/oauth/authorize?' +
          new URLSearchParams({ ...flow.params, redirect_uri: 'https://evil.example/callback' }),
      )
    ).statusCode,
  ).toBe(400);
  const body = {
    grant_type: 'authorization_code',
    client_id: flow.clientId,
    redirect_uri: flow.params.redirect_uri,
    code: flow.code,
    code_verifier: verifier,
  };
  expect((await exchange({ ...body, code_verifier: 'b'.repeat(64) })).statusCode).toBe(400);
  const issued = await exchange(body);
  expect(issued.statusCode, issued.body).toBe(200);
  expect(issued.json().expires_in).toBeLessThanOrEqual(3600);
  expect((await rpc('tools/list', {}, issued.json().access_token)).statusCode).toBe(200);
  expect((await exchange(body)).json().error).toBe('invalid_grant');
  expect((await rpc('tools/list', {}, issued.json().access_token)).statusCode).toBe(401);
});
it('rotates refresh tokens, permits only scope reduction and revokes the entire family on replay', async () => {
  const flow = await approve(),
    issued = await exchange({
      grant_type: 'authorization_code',
      client_id: flow.clientId,
      redirect_uri: flow.params.redirect_uri,
      code: flow.code,
      code_verifier: verifier,
    });
  const refresh = {
    grant_type: 'refresh_token',
    client_id: flow.clientId,
    refresh_token: issued.json().refresh_token,
  };
  expect(
    (await exchange({ ...refresh, scope: 'secrets:read:' + new ObjectId() })).json().error,
  ).toBe('invalid_scope');
  expect((await exchange({ ...refresh, scope: 'notes:write' })).json().error).toBe('invalid_scope');
  const next = await exchange({ ...refresh, scope: 'notes:read' });
  expect(next.statusCode, next.body).toBe(200);
  expect(next.json().refresh_token).not.toBe(refresh.refresh_token);
  expect(next.json().scope).toBe('notes:read');
  expect(
    (
      await tool(
        'create_note',
        { vaultId, spaceId, path: 'No.md', markdown: 'blocked' },
        next.json().access_token,
      )
    ).isError,
  ).toBe(true);
  expect((await exchange(refresh)).json().error).toBe('invalid_grant');
  expect((await rpc('tools/list', {}, next.json().access_token)).statusCode).toBe(401);
  const serialized = JSON.stringify(await db.collection('oauth_refresh').find({}).toArray());
  expect(serialized).not.toContain(next.json().refresh_token);
  expect(serialized).not.toContain(refresh.refresh_token);
});
it('denies OAuth consent without issuing credentials, binds it to the current user session and enforces expiry', async () => {
  const flow = await oauthRequest();
  const denied = await request('POST', '/api/oauth/consent', {
    request: flow.pending,
    approved: false,
  });
  expect(new URL(denied.json().redirect).searchParams.get('error')).toBe('access_denied');
  expect(await db.collection('oauth_codes').countDocuments({})).toBe(0);
  expect(
    (
      await request('POST', '/api/oauth/consent', {
        request: flow.pending,
        approved: true,
        vaultIds: [vaultId],
        spaceIds: [spaceId],
        scopes: ['notes:read'],
      })
    ).statusCode,
  ).toBe(400);
  const expired = await oauthRequest();
  await db
    .collection('oauth_requests')
    .updateOne({ hash: digest(expired.pending) }, { $set: { expiresAt: new Date(0) } });
  expect((await request('GET', '/api/oauth/requests/' + expired.pending)).statusCode).toBe(400);
});
it('keeps an expired OAuth access token visible so its refresh connection can still be revoked', async () => {
  const flow = await approve();
  const issued = await exchange({
    grant_type: 'authorization_code',
    client_id: flow.clientId,
    redirect_uri: flow.params.redirect_uri,
    code: flow.code,
    code_verifier: verifier,
  });
  expect(issued.statusCode, issued.body).toBe(200);
  const token = await agentStore(db).findOne({ hash: digest(issued.json().access_token) });
  expect(token!.cleanupAt.getTime()).toBeGreaterThan(token!.connectionExpiresAt!.getTime());
  await agentStore(db).updateOne({ _id: token!._id }, { $set: { expiresAt: new Date(0) } });
  expect((await rpc('tools/list', {}, issued.json().access_token)).statusCode).toBe(401);
  const listed = (await request('GET', '/api/agents/tokens')).json().tokens;
  expect(
    listed.find((item: { id: string }) => item.id === token!._id.toHexString()).expiresAt,
  ).toBe(token!.connectionExpiresAt!.toISOString());
  expect((await request('DELETE', '/api/agents/tokens/' + token!._id)).statusCode).toBe(200);
  expect(
    (
      await exchange({
        grant_type: 'refresh_token',
        client_id: flow.clientId,
        refresh_token: issued.json().refresh_token,
      })
    ).json().error,
  ).toBe('invalid_grant');
});
it('bridges the official MCP client over stdio to authenticated Streamable HTTP without stdout noise', async () => {
  await note('Stdio.md', '# From the stdio bridge');
  const port = await new Promise<number>((resolvePort, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      if (!address || typeof address === 'string') throw new Error('No port');
      socket.close(() => resolvePort(address.port));
    });
  });
  await app.close();
  app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      COOKIE_SECURE: 'false',
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
    }),
    db,
    { staticFiles: false, emailService: mail },
  );
  await app.listen({ host: '127.0.0.1', port });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('packages/mcp/dist/cli.js')],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (pair): pair is [string, string] => typeof pair[1] === 'string',
        ),
      ),
      HELIOUS_URL: `http://127.0.0.1:${port}`,
      HELIOUS_TOKEN: raw,
    },
    stderr: 'pipe',
  });
  const sdk = new Client({ name: 'stdio-test', version: '1' });
  try {
    await sdk.connect(transport);
    expect((await sdk.listTools()).tools).toHaveLength(17);
    expect(
      (await sdk.listResources()).resources.some((resource) => resource.uri.endsWith('/Stdio.md')),
    ).toBe(true);
  } finally {
    await sdk.close();
  }
});
