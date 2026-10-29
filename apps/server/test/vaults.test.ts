import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import Fastify, { type FastifyInstance } from 'fastify';
import type { KnowledgePrincipal } from '@helious/core';
import { registerVaults } from '../src/vaults.js';
import { migrateSpaces } from '../src/spaces.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryEmailService } from '../src/email.js';
const mail = new MemoryEmailService();

const origin = 'http://localhost:3000';
let mongo: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;
let owner: Record<string, string>;
let stranger: Record<string, string>;
let vaultId: string;
async function account(email: string) {
  const csrf = await app.inject('/api/auth/csrf');
  const headers = {
    origin,
    'content-type': 'application/json',
    'x-csrf-token': csrf.json().csrfToken,
    cookie: `helious_csrf=${csrf.cookies.find((c) => c.name === 'helious_csrf')!.value}`,
  };
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers,
    payload: { name: 'Reader', email, password: 'a private testing passphrase' },
  });
  expect(response.statusCode).toBe(201);
  const token = /token=([\w-]+)/.exec(
    [...mail.messages].reverse().find((message) => message.to === email)!.text,
  )![1];
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        headers,
        payload: { token },
      })
    ).statusCode,
  ).toBe(200);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers,
    payload: { email, password: 'a private testing passphrase' },
  });
  headers.cookie += `; helious_session=${login.cookies.find((c) => c.name === 'helious_session')!.value}`;
  return headers;
}
const base = () => `/api/vaults/${vaultId}`;
async function note(path: string, markdown = '', spaceId?: string) {
  const response = await app.inject({
    method: 'POST',
    url: `${base()}/notes`,
    headers: owner,
    payload: { path, markdown, ...(spaceId ? { spaceId } : {}) },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().note as { id: string; revision: number; path: string };
}
function upload(path: string, content = Buffer.from('attachment content'), headers = owner) {
  const boundary = 'helious-test-boundary';
  return app.inject({
    method: 'POST',
    url: `${base()}/attachments?path=${encodeURIComponent(path)}`,
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.txt"\r\nContent-Type: text/html\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '7.0.24' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('vault-tests');
});
beforeEach(async () => {
  await db.dropDatabase();
  mail.messages.length = 0;
  app = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
      PUBLIC_URL: origin,
      COOKIE_SECURE: 'false',
    }),
    db,
    { staticFiles: false, emailService: mail },
  );
  await app.ready();
  owner = await account('owner@example.com');
  stranger = await account('other@example.com');
  const response = await app.inject({
    method: 'POST',
    url: '/api/vaults',
    headers: owner,
    payload: { name: 'My knowledge' },
  });
  expect(response.statusCode).toBe(201);
  vaultId = response.json().vault.id;
});
afterEach(async () => {
  await app?.close();
});
afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

it('persists Markdown, frontmatter and tags; paginates metadata and renames vaults', async () => {
  await note('Projects/A.md', '---\ntags: [Code]\n---\n# Architecture\nA useful decision.');
  await note('Other.md');
  const result = await app.inject({ url: `${base()}/notes?path=Projects&limit=1`, headers: owner });
  expect(result.json()).toMatchObject({
    total: 1,
    notes: [{ path: 'Projects/A.md', title: 'Architecture', tags: ['code'], revision: 1 }],
  });
  expect(result.json().notes[0]).not.toHaveProperty('markdown');
  const renamed = await app.inject({
    method: 'PATCH',
    url: base(),
    headers: owner,
    payload: { name: 'Renamed' },
  });
  expect(renamed.json().vault.name).toBe('Renamed');
  expect((await app.inject({ url: '/api/vaults', headers: stranger })).json()).toEqual({
    vaults: [],
  });
});
it('uses atomic revision checks for competing edits and stale deletion', async () => {
  const entry = await note('Decision.md', 'Original');
  const results = await Promise.all(
    ['First', 'Second'].map((markdown) =>
      app.inject({
        method: 'PATCH',
        url: `${base()}/notes/${entry.id}`,
        headers: owner,
        payload: { revision: 1, markdown },
      }),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((response) => response.statusCode === 409)!.json()).toEqual({
    error: 'This note changed elsewhere. Reload it before saving.',
  });
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `${base()}/notes/${entry.id}`,
        headers: owner,
        payload: { revision: 1 },
      })
    ).statusCode,
  ).toBe(409);
  const saved = await app.inject({ url: `${base()}/notes/${entry.id}`, headers: owner });
  expect(saved.json().note.revision).toBe(2);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `${base()}/notes/${entry.id}`,
        headers: owner,
        payload: { revision: 2 },
      })
    ).statusCode,
  ).toBe(200);
});
it('rejects path collisions, traversal and oversize metadata on both creation and moves', async () => {
  const entry = await note('A.md');
  await note('B.md');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${base()}/notes`,
        headers: owner,
        payload: { path: 'a.MD' },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `${base()}/notes/${entry.id}`,
        headers: owner,
        payload: { revision: 1, path: 'B.md' },
      })
    ).statusCode,
  ).toBe(409);
  for (const path of ['../outside.md', '/root.md', 'NUL.md', '.helious/settings.md', 'bad.txt'])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base()}/notes`,
          headers: owner,
          payload: { path },
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${base()}/notes`,
        headers: owner,
        payload: { path: 'Many.md', markdown: '[[a]] '.repeat(10001) },
      })
    ).statusCode,
  ).toBe(422);
});
it('indexes real text, combines literal search filters and removes stale index content on save', async () => {
  const entry = await note('Projects/Design.md', '# Architecture\nA database decision #code');
  await note('Archive.md', 'Another database decision #archive');
  const search = async (q: string) =>
    app.inject({ url: `${base()}/search?q=${encodeURIComponent(q)}`, headers: owner });
  expect(
    (await search('database tag:code path:Projects file:Design -tag:archive'))
      .json()
      .results.map((n: { id: string }) => n.id),
  ).toEqual([entry.id]);
  expect((await search('"database decision"')).json().results).toHaveLength(2);
  expect((await search('.*')).json().results).toHaveLength(0);
  expect((await search('line:2')).statusCode).toBe(400);
  await app.inject({
    method: 'PATCH',
    url: `${base()}/notes/${entry.id}`,
    headers: owner,
    payload: { revision: 1, markdown: 'A changed topic #new' },
  });
  expect((await search('database tag:code')).json().results).toHaveLength(0);
  expect((await app.inject({ url: `${base()}/tags`, headers: owner })).json().tags).toEqual([
    { tag: 'archive', count: 1 },
    { tag: 'new', count: 1 },
  ]);
});
it('builds graph/backlinks from saved notes and reflects moves and deletions', async () => {
  const first = await note('A.md', '[[B#Decision]] [[B]] [[Missing]]');
  const second = await note('B.md', '# Decision');
  const mention = await note('Mention.md', 'A Decision worth remembering.');
  const links = await app.inject({ url: `${base()}/notes/${second.id}/links`, headers: owner });
  expect(links.json().backlinks).toMatchObject([{ id: first.id, path: 'A.md' }]);
  expect(links.json().unlinkedMentions).toMatchObject([{ id: mention.id, path: 'Mention.md' }]);
  const graph = (await app.inject({ url: `${base()}/graph`, headers: owner })).json();
  expect(graph.edges).toEqual([{ source: first.id, target: second.id, count: 2 }]);
  expect(graph.unresolved).toMatchObject([{ target: 'Missing', reason: 'missing' }]);
  await app.inject({
    method: 'PATCH',
    url: `${base()}/notes/${second.id}`,
    headers: owner,
    payload: { revision: 1, path: 'Moved.md' },
  });
  expect((await app.inject({ url: `${base()}/graph`, headers: owner })).json().edges).toEqual(
    graph.edges,
  );
  expect(
    (await app.inject({ url: `${base()}/notes/${first.id}`, headers: owner })).json().note.markdown,
  ).toContain('[[/Moved.md#Decision]]');
});

it('moves and rewrites in one transaction; collisions and stale revisions leave every note unchanged', async () => {
  const first = await note('A.md', '[[B]]');
  const second = await note('B.md', '# B');
  await note('Occupied.md');
  // Existing Phase 2 notes retain old parsed metadata until they are saved or moved.
  await db
    .collection('notes')
    .updateOne(
      { _id: new ObjectId(first.id) },
      { $unset: { 'parsed.links.0.targetStart': '', 'parsed.links.0.targetEnd': '' } },
    );
  const collision = await app.inject({
    method: 'PATCH',
    url: `${base()}/notes/${second.id}`,
    headers: owner,
    payload: { path: 'Occupied.md', revision: 1 },
  });
  expect(collision.statusCode).toBe(409);
  expect(
    (await app.inject({ url: `${base()}/notes/${first.id}`, headers: owner })).json().note,
  ).toMatchObject({ revision: 1, markdown: '[[B]]' });
  const moved = await app.inject({
    method: 'PATCH',
    url: `${base()}/notes/${second.id}`,
    headers: owner,
    payload: { path: 'New/B.md', revision: 1 },
  });
  expect(moved.statusCode, moved.body).toBe(200);
  expect(moved.json()).toMatchObject({ updatedLinks: 1, changedNotes: 2 });
  const stale = await app.inject({
    method: 'PATCH',
    url: `${base()}/notes/${first.id}`,
    headers: owner,
    payload: { markdown: 'stale draft', revision: 1 },
  });
  expect(stale.statusCode).toBe(409);
  expect(
    (await app.inject({ url: `${base()}/notes/${first.id}`, headers: owner })).json().note,
  ).toMatchObject({ revision: 2, markdown: '[[/New/B.md]]' });
});
it('never leaks another account’s vault, note, search, tags, graph, backlinks or attachment', async () => {
  const entry = await note('Private.md', '# Only the owner\n[[Private]] #private');
  const file = await upload('Attachments/private.txt');
  expect(file.statusCode, file.body).toBe(201);
  for (const suffix of [
    '',
    '/notes',
    `/notes/${entry.id}`,
    '/search?q=owner',
    '/tags',
    '/graph',
    '/graph?includeFiles=true',
    '/analytics',
    `/notes/${entry.id}/links`,
    '/attachments',
    `/attachments/${file.json().attachment.id}`,
  ]) {
    const response = await app.inject({ url: base() + suffix, headers: stranger });
    expect(response.statusCode, suffix).toBe(404);
    expect(response.body).not.toContain('Only the owner');
  }
  for (const method of ['PATCH', 'DELETE'] as const)
    expect(
      (
        await app.inject({
          method,
          url: `${base()}/notes/${entry.id}`,
          headers: stranger,
          payload: { revision: 1, ...(method === 'PATCH' ? { markdown: 'stolen' } : {}) },
        })
      ).statusCode,
    ).toBe(404);
  expect((await upload('stolen.txt', undefined, stranger)).statusCode).toBe(404);
  expect((await app.inject({ url: '/api/vaults' })).statusCode).toBe(401);
});
it('includes real attachments and unresolved targets in exploration, and records only committed activity', async () => {
  const first = await note(
    'A.md',
    '# Alpha\n[[B]] [[B]] [[Missing]] ![[Attachments/picture.png]] #code',
  );
  const second = await note('B.md', '# Beta');
  await note('Orphan.md', 'A quiet note #journal');
  const file = (await upload('Attachments/picture.png')).json().attachment;
  const snapshot = (
    await app.inject({ url: `${base()}/graph?includeFiles=true`, headers: owner })
  ).json();
  expect(snapshot.nodes).toHaveLength(5);
  expect(snapshot.nodes.find((item: { kind: string }) => item.kind === 'attachment')).toMatchObject(
    { id: `attachment:${file.id}`, incoming: 1 },
  );
  expect(snapshot.nodes.find((item: { id: string }) => item.id === first.id)).toMatchObject({
    kind: 'note',
    title: 'Alpha',
    tags: ['code'],
  });
  expect(snapshot.unresolved).toMatchObject([{ target: 'Missing' }]);
  const stats = () => app.inject({ url: `${base()}/analytics`, headers: owner });
  expect((await stats()).json()).toMatchObject({
    noteCount: 3,
    links: 3,
    unresolvedLinks: 1,
    orphans: 1,
    agentActivityAvailable: true,
    activity: [{ count: 3 }],
  });
  await app.inject({
    method: 'PATCH',
    url: `${base()}/notes/${first.id}`,
    headers: owner,
    payload: { revision: 1, markdown: '# Updated\n[[B]]' },
  });
  expect((await stats()).json().activity).toMatchObject([{ count: 4 }]);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `${base()}/notes/${first.id}`,
        headers: owner,
        payload: { revision: 1, markdown: 'Stale write' },
      })
    ).statusCode,
  ).toBe(409);
  expect((await stats()).json().activity).toMatchObject([{ count: 4 }]);
  await app.inject({
    method: 'DELETE',
    url: `${base()}/notes/${second.id}`,
    headers: owner,
    payload: { revision: 1 },
  });
  expect((await stats()).json()).toMatchObject({
    noteCount: 2,
    unresolvedLinks: 1,
    activity: [{ count: 5 }],
  });
});

it('returns more than 10,000 real graph nodes without truncation or crossing accounts', async () => {
  const sample = await note('Seed.md');
  const template = (await db.collection('notes').findOne({ _id: new ObjectId(sample.id) }))!;
  await db.collection('notes').insertMany(
    Array.from({ length: 10004 }, (_unused, i) => ({
      ...template,
      _id: new ObjectId(),
      path: `Large/${i}.md`,
      pathKey: `large/${i}.md`,
    })),
  );
  const response = await app.inject({ url: `${base()}/graph?includeFiles=true`, headers: owner });
  expect(response.statusCode).toBe(200);
  expect(response.json().nodes).toHaveLength(10005);
  expect((await app.inject({ url: `${base()}/analytics`, headers: stranger })).statusCode).toBe(
    404,
  );
});

it('streams GridFS files, forces safe downloads, checks CSRF and cascades vault deletion', async () => {
  await note('A.md');
  const response = await upload(
    'Attachments/sample.html',
    Buffer.from('<script>alert(1)</script>'),
  );
  expect(response.statusCode, response.body).toBe(201);
  const file = response.json().attachment;
  expect(file.size).toBe(25);
  const download = await app.inject({ url: `${base()}/attachments/${file.id}`, headers: owner });
  expect(download.body).toBe('<script>alert(1)</script>');
  expect(download.headers['content-type']).toBe('application/octet-stream');
  expect(download.headers['content-disposition']).toContain('attachment;');
  expect((await upload('attachments/SAMPLE.html')).statusCode).toBe(409);
  expect((await upload('../outside')).statusCode).toBe(400);
  expect(
    (await upload('no-csrf.txt', undefined, { ...owner, 'x-csrf-token': '' })).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ method: 'DELETE', url: base(), headers: owner, payload: {} })).statusCode,
  ).toBe(200);
  for (const collection of [
    'notes',
    'note_changes',
    'attachmentFiles',
    'attachments.files',
    'attachments.chunks',
  ])
    expect(await db.collection(collection).countDocuments()).toBe(0);
});
it('cleans up an oversized GridFS upload instead of exposing partial data', async () => {
  const response = await upload('Too large.bin', Buffer.alloc(20 * 1024 * 1024 + 1));
  expect(response.statusCode, response.body).toBe(413);
  for (const collection of ['attachmentFiles', 'attachments.files', 'attachments.chunks'])
    expect(await db.collection(collection).countDocuments()).toBe(0);
});

async function spaceIds() {
  const response = await app.inject({ url: `${base()}/spaces`, headers: owner });
  expect(response.statusCode).toBe(200);
  const spaces = response.json().spaces as {
    id: string;
    kind: string;
    revision: number;
    agentAccess: string;
  }[];
  return {
    personal: spaces.find((space) => space.kind === 'personal')!,
    code: spaces.find((space) => space.kind === 'code')!,
  };
}
async function agentAdapter(
  spaceId: string,
  scopes: ('notes:read' | 'notes:write')[] = ['notes:read', 'notes:write'],
) {
  const user = (await db.collection('users').findOne({ email: 'owner@example.com' }))!;
  const principal: KnowledgePrincipal = {
    kind: 'agent',
    ownerId: user._id.toHexString(),
    actorId: 'future-mcp-token',
    vaultIds: [vaultId],
    spaceIds: [spaceId],
    scopes,
  };
  // Trusted principal injection exercises the same knowledge routes used by future MCP auth.
  // The production app only supplies its cookie-session resolver; no HTTP header enables this adapter.
  const adapter = Fastify();
  adapter.setErrorHandler((error, _request, reply) =>
    reply
      .code((error as { statusCode?: number }).statusCode ?? 500)
      .send({ error: (error as Error).message }),
  );
  await registerVaults(
    adapter,
    db,
    async () => {},
    () => principal,
  );
  await adapter.ready();
  return adapter;
}
it('creates safe default spaces, filters every collection by space and versions space changes', async () => {
  const { personal, code } = await spaceIds();
  expect(personal.agentAccess).toBe('none');
  const privateNote = await note('Private.md', '# Private\nprivate-body-marker #private');
  const shared = await note('Architecture.md', '# Architecture\n[[Private]] #code', code.id);
  expect(
    (await app.inject({ url: `${base()}/notes?spaceId=${code.id}`, headers: owner }))
      .json()
      .notes.map((note: { id: string }) => note.id),
  ).toEqual([shared.id]);
  const graph = await app.inject({
    url: `${base()}/graph?includeFiles=true&spaceId=${code.id}`,
    headers: owner,
  });
  expect(graph.json().nodes.map((note: { id: string }) => note.id)).toEqual([shared.id]);
  expect(graph.body).not.toContain('Private');
  const custom = await app.inject({
    method: 'POST',
    url: `${base()}/spaces`,
    headers: owner,
    payload: { name: 'Client X' },
  });
  expect(custom.statusCode, custom.body).toBe(201);
  expect(custom.json().space.agentAccess).toBe('none');
  const id = custom.json().space.id;
  const rename = await app.inject({
    method: 'PATCH',
    url: `${base()}/spaces/${id}`,
    headers: owner,
    payload: { revision: 1, name: 'Research', agentAccess: 'read' },
  });
  expect(rename.json().space).toMatchObject({ name: 'Research', agentAccess: 'read', revision: 2 });
  const renameOnly = await app.inject({
    method: 'PATCH',
    url: `${base()}/spaces/${id}`,
    headers: owner,
    payload: { revision: 2, name: 'Client research' },
  });
  expect(renameOnly.json().space.agentAccess).toBe('read');
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `${base()}/spaces/${id}`,
        headers: owner,
        payload: { revision: 2, agentAccess: 'none' },
      })
    ).statusCode,
  ).toBe(409);
  const moved = await app.inject({
    method: 'PATCH',
    url: `${base()}/notes/${privateNote.id}`,
    headers: owner,
    payload: { revision: 1, spaceId: id },
  });
  expect(moved.json().note.spaceId).toBe(id);
  // A display filter must not narrow the transactional set of authorized inbound rewrites.
  const renamedAcrossFilter = await app.inject({
    method: 'PATCH',
    url: `${base()}/notes/${privateNote.id}?spaceId=${personal.id}`,
    headers: owner,
    payload: { revision: 2, path: 'Private renamed.md' },
  });
  expect(renamedAcrossFilter.statusCode, renamedAcrossFilter.body).toBe(200);
  expect(renamedAcrossFilter.json().updatedLinks).toBe(1);
  const analytics = await app.inject({ url: `${base()}/analytics?spaceId=${id}`, headers: owner });
  expect(analytics.json()).toMatchObject({ noteCount: 1, words: 3 });
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `${base()}/spaces/${id}`,
        headers: owner,
        payload: {},
      })
    ).statusCode,
  ).toBe(409);
  expect((await app.inject({ url: `${base()}/spaces`, headers: stranger })).statusCode).toBe(404);
});
it('keeps Personal out of agent search, graph, links, tags, history, attachments and analytics, including after deletion', async () => {
  const { personal, code } = await spaceIds();
  const hidden = await note('Private.md', '# Private\nprivate-body-marker #only-personal');
  const publicNote = await note('Code.md', '# Public work\n[[Private]] [[Unknown]] #code', code.id);
  await note('Private backlink.md', '[[Code]] #only-personal');
  const file = await upload('private-attachment.txt');
  const agent = await agentAdapter(code.id);
  try {
    expect((await agent.inject(`${base()}/notes`)).json().total).toBe(1);
    expect((await agent.inject(`${base()}/search?q=private-body-marker`)).json().results).toEqual(
      [],
    );
    expect((await agent.inject(`${base()}/tags`)).body).not.toContain('only-personal');
    for (const endpoint of [
      '/graph',
      '/graph?includeFiles=true',
      `/notes/${publicNote.id}/links`,
      '/deleted-notes',
    ]) {
      const result = await agent.inject(`${base()}${endpoint}`);
      expect(result.statusCode, result.body).toBe(200);
      expect(result.body).not.toContain('Private');
      expect(result.body).not.toContain(hidden.id);
    }
    for (const endpoint of [
      `/notes/${hidden.id}`,
      `/notes/${hidden.id}/history`,
      `/notes/${hidden.id}/history/1`,
      `/attachments/${file.json().attachment.id}`,
      `/notes?spaceId=${personal.id}`,
    ])
      expect((await agent.inject(`${base()}${endpoint}`)).statusCode).toBe(404);
    expect((await agent.inject(`${base()}/attachments`)).json().attachments).toEqual([]);
    expect((await agent.inject(`${base()}/analytics`)).json()).toMatchObject({
      noteCount: 1,
      words: 5,
      orphans: 0,
      unresolvedLinks: 1,
    });
    await app.inject({
      method: 'DELETE',
      url: `${base()}/notes/${hidden.id}`,
      headers: owner,
      payload: { revision: 1 },
    });
    const after = await agent.inject(`${base()}/graph?includeFiles=true`);
    expect(after.body).not.toContain('Private');
    expect((await agent.inject(`${base()}/notes/${publicNote.id}/links`)).body).not.toContain(
      'Private',
    );
    expect(
      (
        await agent.inject({
          method: 'POST',
          url: `${base()}/notes`,
          payload: { path: 'Denied.md', spaceId: personal.id },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await agent.inject({
          method: 'POST',
          url: `${base()}/spaces`,
          payload: { name: 'Escalation' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await agent.inject({
          method: 'PATCH',
          url: `${base()}/spaces/${code.id}`,
          payload: { revision: 1, agentAccess: 'read-write' },
        })
      ).statusCode,
    ).toBe(403);
    await app.inject({
      method: 'PATCH',
      url: `${base()}/spaces/${code.id}`,
      headers: owner,
      payload: { revision: 1, agentAccess: 'none' },
    });
    expect((await agent.inject('/api/vaults')).json().vaults).toEqual([]);
    expect((await agent.inject(`${base()}/notes/${publicNote.id}`)).statusCode).toBe(404);
    expect(
      (
        await agent.inject({
          method: 'PATCH',
          url: `${base()}/notes/${publicNote.id}`,
          payload: { revision: 1, markdown: 'No' },
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await agent.close();
  }
});
it('attributes agent writes and rejects moves that would rewrite inaccessible notes atomically', async () => {
  const { code } = await spaceIds();
  const entry = await note('Shared.md', '# A decision', code.id);
  await note('Personal backlink.md', '[[Shared]]');
  const agent = await agentAdapter(code.id);
  try {
    const edit = await agent.inject({
      method: 'PATCH',
      url: `${base()}/notes/${entry.id}`,
      payload: { revision: 1, markdown: '# A better decision' },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    const move = await agent.inject({
      method: 'PATCH',
      url: `${base()}/notes/${entry.id}`,
      payload: { revision: 2, path: 'Moved.md' },
    });
    expect(move.statusCode, move.body).toBe(404);
    expect((await agent.inject(`${base()}/notes/${entry.id}`)).json().note).toMatchObject({
      path: 'Shared.md',
      revision: 2,
    });
    const history = (await agent.inject(`${base()}/notes/${entry.id}/history`)).json();
    expect(history.versions).toHaveLength(2);
    expect(history.versions[0].actor).toEqual({ kind: 'agent', id: 'future-mcp-token' });
    const readOnly = await agentAdapter(code.id, ['notes:read']);
    try {
      expect(
        (
          await readOnly.inject({
            method: 'PATCH',
            url: `${base()}/notes/${entry.id}`,
            payload: { revision: 2, markdown: 'Denied' },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await readOnly.close();
    }
  } finally {
    await agent.close();
  }
});
it('retains diffs and deleted notes, restores as new revisions and never exposes an old Personal revision through Code', async () => {
  const { personal, code } = await spaceIds();
  const entry = await note('Decision.md', 'Private original');
  const edit = await app.inject({
    method: 'PATCH',
    url: `${base()}/notes/${entry.id}`,
    headers: owner,
    payload: { revision: 1, markdown: 'Shared replacement', spaceId: code.id },
  });
  expect(edit.statusCode).toBe(200);
  const agent = await agentAdapter(code.id);
  try {
    const history = (await agent.inject(`${base()}/notes/${entry.id}/history`)).json();
    expect(history.versions.map((version: { revision: number }) => version.revision)).toEqual([2]);
    expect((await agent.inject(`${base()}/notes/${entry.id}/history/1`)).statusCode).toBe(404);
    expect(
      (
        await agent.inject({
          method: 'POST',
          url: `${base()}/notes/${entry.id}/history/1/restore`,
          payload: { revision: 2 },
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await agent.close();
  }
  const restored = await app.inject({
    method: 'POST',
    url: `${base()}/notes/${entry.id}/history/1/restore`,
    headers: owner,
    payload: { revision: 2 },
  });
  expect(restored.json()).toMatchObject({ revision: 3, spaceId: personal.id });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${base()}/notes/${entry.id}/history/2/restore`,
        headers: owner,
        payload: { revision: 2 },
      })
    ).statusCode,
  ).toBe(409);
  await app.inject({
    method: 'DELETE',
    url: `${base()}/notes/${entry.id}`,
    headers: owner,
    payload: { revision: 3 },
  });
  expect(
    (await app.inject({ url: `${base()}/notes/${entry.id}`, headers: owner })).statusCode,
  ).toBe(404);
  expect(
    (await app.inject({ url: `${base()}/search?q=Private`, headers: owner })).json().results,
  ).toEqual([]);
  expect(
    (await app.inject({ url: `${base()}/deleted-notes`, headers: owner })).json().notes[0],
  ).toMatchObject({ id: entry.id, revision: 4 });
  const replacement = await note('Decision.md', 'A different note at the same path');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${base()}/notes/${entry.id}/history/1/restore`,
        headers: owner,
        payload: { revision: 4 },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    await db.collection('note_versions').countDocuments({ noteId: new ObjectId(entry.id) }),
  ).toBe(4);
  await app.inject({
    method: 'DELETE',
    url: `${base()}/notes/${replacement.id}`,
    headers: owner,
    payload: { revision: 1 },
  });
  const recovered = await app.inject({
    method: 'POST',
    url: `${base()}/notes/${entry.id}/history/1/restore`,
    headers: owner,
    payload: { revision: 4 },
  });
  expect(recovered.json().revision).toBe(5);
  expect(
    (await app.inject({ url: `${base()}/notes/${entry.id}`, headers: owner })).json().note.markdown,
  ).toBe('Private original');
  expect(
    (await app.inject({ url: `${base()}/notes/${entry.id}/history`, headers: owner }))
      .json()
      .versions.map((version: { action: string }) => version.action),
  ).toEqual(['restore', 'delete', 'restore', 'update', 'create']);
  expect(
    (await app.inject({ url: `${base()}/notes/${entry.id}/history/1`, headers: stranger }))
      .statusCode,
  ).toBe(404);
});
it('migrates unclassified notes, files and activity into Personal once and preserves a labelled baseline', async () => {
  const entry = await note('Legacy.md', '# Existing knowledge');
  await upload('legacy.txt');
  await db
    .collection('notes')
    .updateOne({ _id: new ObjectId(entry.id) }, { $unset: { spaceId: '', deleted: '' } });
  await db.collection('attachmentFiles').updateMany({}, { $unset: { spaceId: '' } });
  await db.collection('note_changes').updateMany({}, { $unset: { spaceId: '' } });
  await db.collection('note_versions').deleteMany({});
  await db.collection('spaces').deleteMany({});
  await db
    .collection('vaults')
    .updateOne({ _id: new ObjectId(vaultId) }, { $unset: { spaceSchema: '' } });
  await migrateSpaces(db);
  const { personal } = await spaceIds();
  const migrated = (await db.collection('notes').findOne({ _id: new ObjectId(entry.id) }))!;
  expect(migrated.spaceId.toHexString()).toBe(personal.id);
  expect(migrated.deleted).toBe(false);
  expect((await db.collection('attachmentFiles').findOne({}))!.spaceId.toHexString()).toBe(
    personal.id,
  );
  expect((await db.collection('note_changes').findOne({}))!.spaceId.toHexString()).toBe(
    personal.id,
  );
  const baseline = (await db.collection('note_versions').findOne({}))!;
  expect(baseline).toMatchObject({
    action: 'baseline',
    markdown: '# Existing knowledge',
    actor: { kind: 'migration', id: 'phase-5' },
  });
  await migrateSpaces(db);
  expect(await db.collection('spaces').countDocuments()).toBe(2);
  expect(await db.collection('note_versions').countDocuments()).toBe(1);
});
