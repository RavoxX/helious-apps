import { pipeline } from 'node:stream/promises';
import { MongoServerError, ObjectId, type Db, type Filter } from 'mongodb';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  basename,
  createLinkResolver,
  escapeRegex,
  normalizeNotePath,
  normalizeVaultPath,
  parseMarkdown,
  parseSearchQuery,
  pathKey,
  planNoteMove,
  summarizeKnowledge,
  type IndexedNote,
} from '@helious/core';
import {
  initializeVaultDatabase,
  type AttachmentDocument,
  type NoteDocument,
  type VaultDocument,
} from './vault-db.js';
import { withVaultWrite, vaultWriteError } from './vault-writes.js';
import { indexedVaultNotes, recordNoteChange, vaultKnowledgeGraph } from './insights.js';
import { ensureDefaultSpaces, migrateSpaces, snapshot } from './spaces.js';
import { createVaultAccess, type PrincipalResolver, type AccessVerifier } from './vault-access.js';
import { registerSpaceRoutes } from './space-routes.js';
import { registerHistoryRoutes } from './history-routes.js';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
const idSchema = { type: 'string', pattern: '^[a-f0-9]{24}$' };
const paramsSchema = {
  type: 'object',
  required: ['vaultId'],
  properties: { vaultId: idSchema, noteId: idSchema, attachmentId: idSchema },
};
const revisionSchema = { type: 'integer', minimum: 1 };
const noteBody = z
  .object({
    path: z.string().max(1024),
    markdown: z.string().max(1_000_000).default(''),
    spaceId: z
      .string()
      .regex(/^[a-f0-9]{24}$/)
      .optional(),
  })
  .strict();
const updateBody = z
  .object({
    revision: z.number().int().positive(),
    path: z.string().max(1024).optional(),
    markdown: z.string().max(1_000_000).optional(),
    spaceId: z
      .string()
      .regex(/^[a-f0-9]{24}$/)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.path !== undefined || value.markdown !== undefined || value.spaceId !== undefined,
  );
const noteSummary = (note: NoteDocument) => ({
  id: note._id.toHexString(),
  spaceId: note.spaceId?.toHexString(),
  path: note.path,
  title: note.parsed.title ?? basename(note.path).replace(/\.md$/i, ''),
  tags: note.parsed.tags,
  wordCount: note.parsed.wordCount,
  revision: note.revision,
  createdAt: note.createdAt.toISOString(),
  updatedAt: note.updatedAt.toISOString(),
});
const noteResponse = (note: NoteDocument) => ({
  ...noteSummary(note),
  markdown: note.markdown,
  metadata: {
    properties: note.parsed.properties,
    headings: note.parsed.headings,
    blocks: note.parsed.blocks,
    warnings: note.parsed.warnings,
  },
});
const vaultResponse = (vault: VaultDocument) => ({
  id: vault._id.toHexString(),
  name: vault.name,
  kind: 'server',
  createdAt: vault.createdAt.toISOString(),
  updatedAt: vault.updatedAt.toISOString(),
});
const attachmentResponse = (file: AttachmentDocument) => ({
  id: file._id.toHexString(),
  spaceId: file.spaceId?.toHexString(),
  path: file.path,
  mimeType: file.mimeType,
  size: file.size,
  createdAt: file.createdAt.toISOString(),
});
const requestError = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw requestError('Check the submitted fields and try again.');
  return result.data;
};
const portablePath = (value: string, note = false) => {
  try {
    return note ? normalizeNotePath(value) : normalizeVaultPath(value);
  } catch (error) {
    throw requestError(error instanceof Error ? error.message : 'Invalid path');
  }
};
const duplicate = (error: unknown) => error instanceof MongoServerError && error.code === 11000;
const parseNote = (markdown: string) => {
  try {
    return parseMarkdown(markdown);
  } catch (error) {
    if (error instanceof RangeError) throw requestError(error.message, 422);
    throw error;
  }
};

export async function registerVaults(
  app: FastifyInstance,
  db: Db,
  authenticate: Guard,
  principal?: PrincipalResolver,
  verify?: AccessVerifier,
) {
  const store = await initializeVaultDatabase(db);
  await migrateSpaces(db);
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  const guard = { preHandler: authenticate };
  const access = createVaultAccess(db, principal, verify);
  const { owner, requireVault } = access;
  const scope = access.base;
  const contentScope = async (
    request: FastifyRequest,
    vaultId: string,
    operation: 'read' | 'write' = 'read',
    session?: import('mongodb').ClientSession,
  ) => ({
    ...(await access.scope(request, vaultId, operation, session, operation === 'read')),
    deleted: { $ne: true as const },
  });
  const actor = (request: FastifyRequest) => ({
    kind: access.principal(request).kind,
    id: access.principal(request).actorId,
  });
  await registerSpaceRoutes(app, db, guard, access);
  await registerHistoryRoutes(app, db, guard, access);
  const schema = (summary: string, extra: Record<string, unknown> = {}) => ({
    tags: ['Knowledge'],
    summary,
    security: [{ session: [] }],
    ...extra,
  });
  async function requireNote(request: FastifyRequest, vaultId: string, noteId: string) {
    const note = await store.notes.findOne({
      ...(await contentScope(request, vaultId)),
      _id: new ObjectId(noteId),
    });
    if (!note) throw requestError('Note not found', 404);
    return note;
  }
  async function indexedNotes(request: FastifyRequest, vaultId: string) {
    const notes = await indexedVaultNotes(db, owner(request), new ObjectId(vaultId));
    return notes.map((note): IndexedNote => ({
      id: note._id.toHexString(),
      path: note.path,
      parsed: note.parsed,
    }));
  }
  async function removeFile(id: ObjectId) {
    // delete may throw for an interrupted upload with chunks but no GridFS files document.
    try {
      await store.bucket.delete(id);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('File not found')) throw error;
      await db.collection('attachments.chunks').deleteMany({ files_id: id });
    }
  }

  app.get(
    '/api/vaults',
    { ...guard, schema: schema('List your active vaults') },
    async (request) => {
      const actor = access.principal(request);
      const vaults = await store.vaults
        .find({
          ownerId: owner(request),
          state: 'active',
          ...(actor.kind === 'agent'
            ? { _id: { $in: actor.vaultIds.map((id) => new ObjectId(id)) } }
            : {}),
        })
        .sort({ createdAt: 1 })
        .toArray();
      const visible = [];
      for (const vault of vaults)
        if (
          (await access.allowed(request, vault._id.toHexString(), 'read', undefined, false)).length
        )
          visible.push(vaultResponse(vault));
      return { vaults: visible };
    },
  );
  app.post(
    '/api/vaults',
    {
      ...guard,
      schema: schema('Create a server vault', {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
          additionalProperties: false,
        },
      }),
    },
    async (request, reply) => {
      access.requireOwner(request);
      const body = parse(
        z.object({ name: z.string().trim().min(1).max(100) }).strict(),
        request.body,
      );
      const now = new Date();
      const vault: VaultDocument = {
        _id: new ObjectId(),
        ownerId: owner(request),
        name: body.name,
        state: 'active',
        spaceSchema: 5,
        createdAt: now,
        updatedAt: now,
      };
      await db.client.withSession((session) =>
        session.withTransaction(async () => {
          await store.vaults.insertOne(vault, { session });
          await ensureDefaultSpaces(db, vault.ownerId, vault._id, session);
        }),
      );
      return reply.code(201).send({ vault: vaultResponse(vault) });
    },
  );
  app.get<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId',
    { ...guard, schema: schema('Read your vault', { params: paramsSchema }) },
    async (request) => ({
      vault: vaultResponse(await requireVault(request, request.params.vaultId)),
    }),
  );
  app.patch<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId',
    {
      ...guard,
      schema: schema('Rename a vault', {
        params: paramsSchema,
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
          additionalProperties: false,
        },
      }),
    },
    async (request) => {
      access.requireOwner(request);
      const vault = await requireVault(request, request.params.vaultId);
      const body = parse(
        z.object({ name: z.string().trim().min(1).max(100) }).strict(),
        request.body,
      );
      const updated = await store.vaults.findOneAndUpdate(
        { _id: vault._id, ownerId: owner(request), state: 'active' },
        { $set: { name: body.name, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      if (!updated) throw requestError('Vault not found', 404);
      return { vault: vaultResponse(updated) };
    },
  );
  app.delete<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId',
    {
      ...guard,
      schema: schema('Delete a vault and its notes and attachments', { params: paramsSchema }),
    },
    async (request) => {
      access.requireOwner(request);
      const vault = await requireVault(request, request.params.vaultId, true);
      if (vault.state === 'active')
        await withVaultWrite(db, vault._id, owner(request), async (session) => {
          if (
            await db
              .collection('secrets')
              .countDocuments(
                { ...scope(request, request.params.vaultId), state: 'active' },
                { session, limit: 1 },
              )
          )
            throw requestError('Delete stored secrets before deleting this vault.', 409);
          await store.vaults.updateOne(
            { _id: vault._id },
            { $set: { state: 'deleting' } },
            { session },
          );
        });
      for await (const file of store.attachments.find(scope(request, request.params.vaultId))) {
        await removeFile(file._id);
        await store.attachments.deleteOne({ _id: file._id });
      }
      await store.notes.deleteMany(scope(request, request.params.vaultId));
      await store.versions.deleteMany(scope(request, request.params.vaultId));
      await store.spaces.deleteMany(scope(request, request.params.vaultId));
      await db.collection('note_changes').deleteMany(scope(request, request.params.vaultId));
      await store.vaults.deleteOne({ _id: vault._id, ownerId: owner(request), state: 'deleting' });
      return { ok: true };
    },
  );

  app.get<{
    Params: { vaultId: string };
    Querystring: { limit?: number; offset?: number; path?: string; spaceId?: string };
  }>(
    '/api/vaults/:vaultId/notes',
    {
      ...guard,
      schema: schema('List note metadata with pagination and an optional folder prefix', {
        params: paramsSchema,
        querystring: {
          type: 'object',
          properties: {
            spaceId: idSchema,
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
            path: { type: 'string', maxLength: 1024 },
          },
          additionalProperties: false,
        },
      }),
    },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      const filter: Filter<NoteDocument> = await contentScope(request, request.params.vaultId);
      if (request.query.path)
        filter.path = {
          $regex: `^${escapeRegex(portablePath(request.query.path.replace(/\/$/, '')))}/`,
        };
      const [notes, total] = await Promise.all([
        store.notes
          .find(filter, {
            projection: {
              path: 1,
              spaceId: 1,
              'parsed.title': 1,
              'parsed.tags': 1,
              'parsed.wordCount': 1,
              revision: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          })
          .sort({ pathKey: 1 })
          .skip(request.query.offset ?? 0)
          .limit(request.query.limit ?? 50)
          .toArray(),
        store.notes.countDocuments(filter),
      ]);
      return { notes: notes.map(noteSummary), total, offset: request.query.offset ?? 0 };
    },
  );
  app.post<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId/notes',
    {
      ...guard,
      bodyLimit: 4_100_000,
      schema: schema('Create a Markdown note', {
        params: paramsSchema,
        body: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', maxLength: 1024 },
            markdown: { type: 'string', maxLength: 1000000 },
            spaceId: idSchema,
          },
          additionalProperties: false,
        },
      }),
    },
    async (request, reply) => {
      await requireVault(request, request.params.vaultId);
      const body = parse(noteBody, request.body);
      const path = portablePath(body.path, true);
      const parsed = parseNote(body.markdown);
      const now = new Date();
      const note: NoteDocument = {
        _id: new ObjectId(),
        ...scope(request, request.params.vaultId),
        deleted: false,
        path,
        pathKey: pathKey(path),
        markdown: body.markdown,
        parsed,
        searchText: `${path} ${parsed.title ?? ''} ${parsed.text}`,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      await withVaultWrite(db, note.vaultId, owner(request), async (session) => {
        const space = await access.requireSpace(
          request,
          request.params.vaultId,
          body.spaceId,
          'write',
          session,
        );
        note.spaceId = space._id;
        await store.notes.insertOne(note, { session });
        await snapshot(db, note, 'create', actor(request), session);
        await recordNoteChange(
          db,
          owner(request),
          note.vaultId,
          note._id,
          'create',
          session,
          note.spaceId,
        );
      });
      return reply.code(201).send({ note: noteResponse(note) });
    },
  );
  app.get<{ Params: { vaultId: string; noteId: string } }>(
    '/api/vaults/:vaultId/notes/:noteId',
    {
      ...guard,
      schema: schema('Read a Markdown note and parsed metadata', { params: paramsSchema }),
    },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      return {
        note: noteResponse(
          await requireNote(request, request.params.vaultId, request.params.noteId),
        ),
      };
    },
  );
  app.patch<{ Params: { vaultId: string; noteId: string } }>(
    '/api/vaults/:vaultId/notes/:noteId',
    {
      ...guard,
      bodyLimit: 4_100_000,
      schema: schema('Save or move a note with an expected revision', {
        params: paramsSchema,
        body: {
          type: 'object',
          required: ['revision'],
          properties: {
            revision: revisionSchema,
            path: { type: 'string', maxLength: 1024 },
            markdown: { type: 'string', maxLength: 1000000 },
            spaceId: idSchema,
          },
          additionalProperties: false,
        },
      }),
    },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      const body = parse(updateBody, request.body);
      return withVaultWrite(
        db,
        new ObjectId(request.params.vaultId),
        owner(request),
        async (session) => {
          const filter = await contentScope(request, request.params.vaultId, 'write', session);
          const existing = await store.notes.findOne(
            { ...filter, _id: new ObjectId(request.params.noteId) },
            { session },
          );
          if (!existing) throw requestError('Note not found', 404);
          if (existing.revision !== body.revision)
            throw vaultWriteError('This note changed elsewhere. Reload it before saving.');
          const destination = await access.requireSpace(
            request,
            request.params.vaultId,
            body.spaceId ?? existing.spaceId?.toHexString(),
            'write',
            session,
          );
          await snapshot(db, existing, 'baseline', actor(request), session);
          const path = portablePath(body.path ?? existing.path, true);
          const markdown = body.markdown ?? existing.markdown;
          const parsed = parseNote(markdown);
          let changes = [{ id: existing._id.toHexString(), path, markdown, rewrites: 0 }];
          if (path !== existing.path) {
            const notes: NoteDocument[] = [];
            let bytes = 0;
            for await (const note of store.notes.find(
              { ...scope(request, request.params.vaultId), deleted: { $ne: true } },
              { session },
            )) {
              const content = note._id.equals(existing._id) ? markdown : note.markdown;
              bytes += Buffer.byteLength(content, 'utf8');
              if (notes.length >= 10000 || bytes > 16 * 1024 * 1024)
                throw requestError(
                  'Atomic moves are limited to 10,000 notes and 16 MiB of Markdown per vault.',
                  422,
                );
              // Reparse legacy notes too: Phase 2 metadata has no editable destination spans.
              notes.push({
                ...note,
                markdown: content,
                parsed: note._id.equals(existing._id) ? parsed : parseNote(content),
              });
            }
            try {
              changes = planNoteMove(
                notes.map((note) => ({
                  id: note._id.toHexString(),
                  path: note.path,
                  markdown: note.markdown,
                  parsed: note.parsed,
                })),
                existing._id.toHexString(),
                path,
              );
            } catch (error) {
              throw vaultWriteError(
                error instanceof Error ? error.message : 'Cannot move this note',
              );
            }
          }
          for (const change of changes) {
            const before = await store.notes.findOne(
              { ...scope(request, request.params.vaultId), _id: new ObjectId(change.id) },
              { session },
            );
            if (!before) throw requestError('Note not found', 404);
            await access.requireSpace(
              request,
              request.params.vaultId,
              before.spaceId?.toHexString(),
              'write',
              session,
            );
            await snapshot(db, before, 'baseline', actor(request), session);
            const metadata = parseNote(change.markdown);
            await store.notes.updateOne(
              { ...filter, _id: new ObjectId(change.id) },
              {
                $set: {
                  path: change.path,
                  spaceId:
                    change.id === existing._id.toHexString() ? destination._id : before.spaceId,
                  pathKey: pathKey(change.path),
                  markdown: change.markdown,
                  parsed: metadata,
                  searchText: `${change.path} ${metadata.title ?? ''} ${metadata.text}`,
                  updatedAt: new Date(),
                },
                $inc: { revision: 1 },
              },
              { session },
            );
            const after = (await store.notes.findOne({ _id: before._id }, { session }))!;
            await snapshot(
              db,
              after,
              path !== existing.path ? 'move' : 'update',
              actor(request),
              session,
            );
            await recordNoteChange(
              db,
              owner(request),
              existing.vaultId,
              new ObjectId(change.id),
              path !== existing.path ? 'move' : 'update',
              session,
              after.spaceId,
            );
          }
          const saved = await store.notes.findOne({ ...filter, _id: existing._id }, { session });
          return {
            note: noteResponse(saved!),
            updatedLinks: changes.reduce((count, change) => count + change.rewrites, 0),
            changedNotes: changes.length,
          };
        },
      );
    },
  );
  app.delete<{ Params: { vaultId: string; noteId: string }; Body: { revision: number } }>(
    '/api/vaults/:vaultId/notes/:noteId',
    {
      ...guard,
      schema: schema('Delete a note with an expected revision', {
        params: paramsSchema,
        body: {
          type: 'object',
          required: ['revision'],
          properties: { revision: revisionSchema },
          additionalProperties: false,
        },
      }),
    },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      await requireNote(request, request.params.vaultId, request.params.noteId);
      await withVaultWrite(
        db,
        new ObjectId(request.params.vaultId),
        owner(request),
        async (session) => {
          const before = await store.notes.findOne(
            {
              ...(await contentScope(request, request.params.vaultId, 'write', session)),
              _id: new ObjectId(request.params.noteId),
            },
            { session },
          );
          if (!before) throw requestError('Note not found', 404);
          if (before.revision !== request.body.revision)
            throw requestError('This note changed elsewhere. Reload it before deleting.', 409);
          await snapshot(db, before, 'baseline', actor(request), session);
          const deleted = (await store.notes.findOneAndUpdate(
            { _id: before._id, revision: before.revision },
            { $set: { deleted: true, updatedAt: new Date() }, $inc: { revision: 1 } },
            { session, returnDocument: 'after' },
          ))!;
          await snapshot(db, deleted, 'delete', actor(request), session);
          await recordNoteChange(
            db,
            owner(request),
            new ObjectId(request.params.vaultId),
            new ObjectId(request.params.noteId),
            'delete',
            session,
            deleted.spaceId,
          );
        },
      );
      return { ok: true };
    },
  );

  app.get<{
    Params: { vaultId: string };
    Querystring: { q?: string; limit?: number; spaceId?: string };
  }>(
    '/api/vaults/:vaultId/search',
    {
      ...guard,
      schema: schema('Search note text with tag:, path:, file:, and -tag: filters', {
        params: paramsSchema,
        querystring: {
          type: 'object',
          properties: {
            spaceId: idSchema,
            q: { type: 'string', maxLength: 256 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
          additionalProperties: false,
        },
      }),
    },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      let query;
      try {
        query = parseSearchQuery(request.query.q ?? '');
      } catch (error) {
        throw requestError(error instanceof Error ? error.message : 'Invalid search query');
      }
      const clauses: Filter<NoteDocument>[] = query.terms.map((term) => ({
        searchText: { $regex: escapeRegex(term), $options: 'i' },
      }));
      const filter: Filter<NoteDocument> = await contentScope(request, request.params.vaultId);
      if (query.terms.some((term) => /[\p{L}\p{N}]/u.test(term)))
        filter.$text = {
          $search: query.terms.map((term) => `"${term.replace(/["\\]/g, ' ')}"`).join(' '),
          $language: 'none',
        };
      if (query.tags.length) clauses.push({ 'parsed.tags': { $all: query.tags } });
      if (query.excludedTags.length) clauses.push({ 'parsed.tags': { $nin: query.excludedTags } });
      for (const path of query.paths)
        clauses.push({ path: { $regex: escapeRegex(path), $options: 'i' } });
      for (const file of query.files)
        clauses.push({ path: { $regex: `(?:^|/)[^/]*${escapeRegex(file)}[^/]*$`, $options: 'i' } });
      if (clauses.length) filter.$and = clauses;
      const notes = await store.notes
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(request.query.limit ?? 50)
        .toArray();
      return {
        results: notes.map((note) => {
          const term = query.terms[0];
          const text = note.parsed.text;
          const index = term ? Math.max(0, text.toLowerCase().indexOf(term.toLowerCase()) - 60) : 0;
          return { ...noteSummary(note), snippet: text.slice(index, index + 220) };
        }),
      };
    },
  );
  app.get<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId/tags',
    { ...guard, schema: schema('List tags in your vault', { params: paramsSchema }) },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      const tags = await store.notes
        .aggregate<{ tag: string; count: number }>([
          { $match: await contentScope(request, request.params.vaultId) },
          { $unwind: '$parsed.tags' },
          { $group: { _id: '$parsed.tags', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, tag: '$_id', count: 1 } },
        ])
        .toArray();
      return { tags };
    },
  );
  app.get<{
    Params: { vaultId: string };
    Querystring: { includeFiles?: boolean; spaceId?: string };
  }>(
    '/api/vaults/:vaultId/graph',
    {
      ...guard,
      schema: schema(
        'Build owner-scoped graph data; includeFiles adds attachments, missing targets and timestamps',
        {
          params: paramsSchema,
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: { spaceId: idSchema, includeFiles: { type: 'boolean', default: false } },
          },
        },
      ),
    },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      const graph = await access.graph(request, request.params.vaultId);
      if (request.query.includeFiles) return graph;
      const ids = new Set(
        graph.nodes.filter((node) => node.kind === 'note').map((node) => node.id),
      );
      const edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
      const counts = new Map([...ids].map((id) => [id, { incoming: 0, outgoing: 0 }]));
      for (const edge of edges) {
        counts.get(edge.source)!.outgoing++;
        counts.get(edge.target)!.incoming++;
      }
      return {
        ...graph,
        nodes: graph.nodes
          .filter((node) => ids.has(node.id))
          .map((node) => ({ ...node, ...counts.get(node.id)! })),
        edges,
      };
    },
  );
  app.get<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId/analytics',
    {
      ...guard,
      schema: schema(
        'Vault statistics, current-note growth and 365 days of recorded note activity (UTC)',
        {
          params: paramsSchema,
          querystring: {
            type: 'object',
            properties: { spaceId: idSchema },
            additionalProperties: false,
          },
        },
      ),
    },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      const graph = await access.graph(request, request.params.vaultId);
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - 364);
      const activity = await db
        .collection('note_changes')
        .aggregate<{ date: string; count: number }>([
          {
            $match: {
              ...(await access.scope(request, request.params.vaultId)),
              at: { $gte: since },
            },
          },
          {
            $group: {
              _id: { $dateToString: { date: '$at', format: '%Y-%m-%d', timezone: 'UTC' } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, date: '$_id', count: 1 } },
        ])
        .toArray();
      const first = await db
        .collection('note_changes')
        .findOne(await access.scope(request, request.params.vaultId), {
          sort: { at: 1 },
          projection: { at: 1 },
        });
      return {
        ...summarizeKnowledge(graph),
        activity,
        activitySince: first?.at?.toISOString() ?? null,
        generatedAt: new Date().toISOString(),
        agentActivityAvailable: true,
        agentActivity: (
          await db
            .collection('agent_activity')
            .find(await access.scope(request, request.params.vaultId))
            .sort({ at: -1 })
            .limit(50)
            .toArray()
        ).map((event) => ({
          id: event._id.toHexString(),
          agent: event.agent,
          tokenId: event.tokenId.toHexString(),
          noteId: event.noteId.toHexString(),
          action: event.action,
          at: event.at.toISOString(),
        })),
      };
    },
  );
  app.get<{ Params: { vaultId: string; noteId: string } }>(
    '/api/vaults/:vaultId/notes/:noteId/links',
    {
      ...guard,
      schema: schema('Resolve outgoing note links and find backlinks', { params: paramsSchema }),
    },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      const note = await requireNote(request, request.params.vaultId, request.params.noteId);
      const notes = await indexedNotes(request, request.params.vaultId);
      const resolve = createLinkResolver(notes);
      const completeGraph = await vaultKnowledgeGraph(
        db,
        owner(request),
        new ObjectId(request.params.vaultId),
      );
      const permitted = await access.graph(request, request.params.vaultId, completeGraph);
      const edges = new Set(permitted.edges.map((edge) => `${edge.source}:${edge.target}`));
      const targets = new Map(
        completeGraph.linkTargets
          .filter((link) => link.source === note._id.toHexString())
          .map((link) => [`${link.line}:${link.target}`, link.targetId]),
      );
      const visible = new Set(
        (
          await store.notes
            .find(await contentScope(request, request.params.vaultId), { projection: { _id: 1 } })
            .toArray()
        ).map((note) => note._id.toHexString()),
      );
      const backlinks = notes.filter(
        (candidate) =>
          visible.has(candidate.id) &&
          candidate.parsed.links.some(
            (link) => resolve(candidate.path, link).noteId === request.params.noteId,
          ),
      );
      const name = note.parsed.title ?? basename(note.path).replace(/\.md$/i, '');
      const mentions = name.trim()
        ? await store.notes
            .find(
              {
                ...(await contentScope(request, request.params.vaultId)),
                _id: { $nin: [note._id, ...backlinks.map((item) => new ObjectId(item.id))] },
                'parsed.text': { $regex: escapeRegex(name), $options: 'i' },
              },
              { projection: { path: 1, 'parsed.title': 1 } },
            )
            .sort({ pathKey: 1 })
            .limit(101)
            .toArray()
        : [];
      return {
        outgoing: note.parsed.links
          .filter((link) => {
            const target = targets.get(`${link.line}:${link.target}`);
            return target && edges.has(`${note._id}:${target}`);
          })
          .map((link) => ({
            ...link,
            resolution: resolve(note.path, link),
          })),
        unlinkedMentions: mentions.slice(0, 100).map((candidate) => ({
          id: candidate._id.toHexString(),
          path: candidate.path,
          title: candidate.parsed.title ?? basename(candidate.path).replace(/\.md$/i, ''),
        })),
        mentionsTruncated: mentions.length > 100,
        backlinks: backlinks.map((candidate) => ({
          id: candidate.id,
          path: candidate.path,
          title: candidate.parsed.title ?? basename(candidate.path).replace(/\.md$/i, ''),
        })),
      };
    },
  );

  app.get<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId/attachments',
    { ...guard, schema: schema('List attachment metadata', { params: paramsSchema }) },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      return {
        attachments: (
          await store.attachments
            .find({ ...(await access.scope(request, request.params.vaultId)), state: 'ready' })
            .sort({ pathKey: 1 })
            .toArray()
        ).map(attachmentResponse),
      };
    },
  );
  app.post<{ Params: { vaultId: string }; Querystring: { path: string; spaceId?: string } }>(
    '/api/vaults/:vaultId/attachments',
    {
      ...guard,
      schema: schema('Stream one multipart attachment into GridFS (20 MiB maximum)', {
        params: paramsSchema,
        consumes: ['multipart/form-data'],
        querystring: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string', maxLength: 1024 }, spaceId: idSchema },
          additionalProperties: false,
        },
      }),
    },
    async (request, reply) => {
      await requireVault(request, request.params.vaultId);
      const space = await access.requireSpace(
        request,
        request.params.vaultId,
        request.query.spaceId,
      );
      const path = portablePath(request.query.path);
      const file = await request.file();
      if (!file) throw requestError('Choose a file to upload');
      const id = new ObjectId();
      const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimetype)
        ? file.mimetype
        : 'application/octet-stream';
      const attachment: AttachmentDocument = {
        _id: id,
        ...scope(request, request.params.vaultId),
        spaceId: space._id,
        path,
        pathKey: pathKey(path),
        mimeType,
        size: 0,
        state: 'uploading',
        createdAt: new Date(),
      };
      try {
        await store.attachments.insertOne(attachment);
      } catch (error) {
        file.file.resume();
        if (duplicate(error)) throw requestError('An attachment already exists at this path', 409);
        throw error;
      }
      const upload = store.bucket.openUploadStreamWithId(id, path, {
        metadata: { ownerId: owner(request), vaultId: attachment.vaultId },
      });
      try {
        await pipeline(file.file, upload);
        if (file.file.truncated) throw requestError('Attachments are limited to 20 MiB', 413);
        if (
          !(await store.vaults.findOne({
            _id: attachment.vaultId,
            ownerId: owner(request),
            state: 'active',
          }))
        )
          throw requestError('Vault not found', 404);
        attachment.size = upload.length;
        attachment.state = 'ready';
        await withVaultWrite(db, attachment.vaultId, owner(request), async (session) => {
          await access.requireSpace(
            request,
            request.params.vaultId,
            attachment.spaceId!.toHexString(),
            'write',
            session,
          );
          await store.attachments.updateOne(
            { _id: id },
            { $set: { size: attachment.size, state: 'ready' } },
            { session },
          );
        });
        return reply.code(201).send({ attachment: attachmentResponse(attachment) });
      } catch (error) {
        await removeFile(id);
        await store.attachments.deleteOne({ _id: id });
        throw error;
      }
    },
  );
  app.get<{ Params: { vaultId: string; attachmentId: string } }>(
    '/api/vaults/:vaultId/attachments/:attachmentId',
    { ...guard, schema: schema('Download an authorized attachment', { params: paramsSchema }) },
    async (request, reply) => {
      await requireVault(request, request.params.vaultId);
      const file = await store.attachments.findOne({
        ...(await access.scope(request, request.params.vaultId)),
        _id: new ObjectId(request.params.attachmentId),
        state: 'ready',
      });
      if (!file) throw requestError('Attachment not found', 404);
      reply
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(basename(file.path))}`,
        )
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', file.size)
        .header('X-Content-Type-Options', 'nosniff');
      return reply.send(store.bucket.openDownloadStream(file._id));
    },
  );
  app.delete<{ Params: { vaultId: string; attachmentId: string } }>(
    '/api/vaults/:vaultId/attachments/:attachmentId',
    { ...guard, schema: schema('Delete an authorized attachment', { params: paramsSchema }) },
    async (request) => {
      await requireVault(request, request.params.vaultId);
      const file = await store.attachments.findOne({
        ...(await access.scope(request, request.params.vaultId, 'write')),
        _id: new ObjectId(request.params.attachmentId),
        state: { $in: ['ready', 'deleting'] },
      });
      if (!file) throw requestError('Attachment not found', 404);
      await withVaultWrite(db, file.vaultId, owner(request), async (session) => {
        await access.requireSpace(
          request,
          request.params.vaultId,
          file.spaceId!.toHexString(),
          'write',
          session,
        );
        await store.attachments.updateOne(
          { _id: file._id },
          { $set: { state: 'deleting' } },
          { session },
        );
      });
      await removeFile(file._id);
      await store.attachments.deleteOne({ _id: file._id, ownerId: owner(request) });
      return { ok: true };
    },
  );
}
