import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ObjectId, type Db } from 'mongodb';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { normalizeVaultPath, pathKey, parseMarkdown, type SyncFile } from '@helious/core';
import { vaultCollections, type NoteDocument, type AttachmentDocument } from './vault-db.js';
import { createVaultAccess } from './vault-access.js';
import { withVaultWrite, vaultWriteError } from './vault-writes.js';
import { snapshot } from './spaces.js';
import { recordNoteChange } from './insights.js';
import type { SecurityService } from './security-service.js';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const id = z.string().regex(/^[a-f0-9]{24}$/);
const fileSchema = z
  .object({
    id,
    kind: z.enum(['note', 'attachment']),
    path: z.string(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    spaceId: id,
    revision: z.number().int().positive(),
  })
  .strict();
const syncBody = z
  .object({
    path: z.string().max(1024),
    kind: z.enum(['note', 'attachment']),
    spaceId: id,
    expected: fileSchema.nullable(),
    data: z
      .string()
      .max(28 * 1024 * 1024)
      .nullable(),
  })
  .strict();
const syncBodyJson = z.toJSONSchema(syncBody, { target: 'draft-7', io: 'input' });
// AJV coerces null to "" when a nullable string uses anyOf. Both are distinct sync operations.
syncBodyJson.properties!.data = { type: ['string', 'null'], maxLength: 28 * 1024 * 1024 };
const paramsSchema = z.toJSONSchema(z.object({ vaultId: id }).strict(), {
  target: 'draft-7',
  io: 'input',
});
const parseNote = (markdown: string) => {
  try {
    return parseMarkdown(markdown);
  } catch {
    throw vaultWriteError('Invalid Markdown metadata.', 400);
  }
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw vaultWriteError('Invalid sync request.', 400);
  return result.data;
}
const noteFile = (note: NoteDocument): SyncFile => ({
  id: note._id.toHexString(),
  kind: 'note',
  path: note.path,
  spaceId: note.spaceId!.toHexString(),
  hash: sha(note.markdown),
  revision: note.revision,
});
const attachmentFile = (file: AttachmentDocument): SyncFile => ({
  id: file._id.toHexString(),
  kind: 'attachment',
  path: file.path,
  spaceId: file.spaceId!.toHexString(),
  hash: file.contentHash!,
  revision: file.revision ?? 1,
});
const equals = (current: SyncFile | null, expected: SyncFile | null) => {
  if (!current || !expected) return current === expected;
  return (
    current.id === expected.id &&
    current.kind === expected.kind &&
    current.path === expected.path &&
    current.spaceId === expected.spaceId &&
    current.revision === expected.revision &&
    !!current.hash &&
    timingSafeEqual(Buffer.from(current.hash, 'hex'), Buffer.from(expected.hash, 'hex'))
  );
};
export async function registerSync(
  app: FastifyInstance,
  db: Db,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  security: SecurityService,
) {
  const store = vaultCollections(db),
    access = createVaultAccess(db),
    guard = { preHandler: authenticate };
  async function ensureHash(file: AttachmentDocument) {
    if (file.contentHash) return file;
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of store.bucket.openDownloadStream(file._id)) {
      size += chunk.length;
      if (size > 20 * 1024 * 1024)
        throw vaultWriteError('Attachment exceeds the sync file limit.', 422);
      hash.update(chunk);
    }
    file.contentHash = hash.digest('hex');
    await store.attachments.updateOne(
      { _id: file._id, state: 'ready' },
      { $set: { contentHash: file.contentHash } },
    );
    return file;
  }
  app.get<{ Params: { vaultId: string }; Querystring: { spaceIds: string } }>(
    '/api/vaults/:vaultId/sync/manifest',
    {
      ...guard,
      schema: {
        tags: ['Sync'],
        summary: 'Owner fingerprints for explicitly selected Spaces',
        params: paramsSchema,
        querystring: z.toJSONSchema(z.object({ spaceIds: z.string().min(24).max(2500) }).strict(), {
          target: 'draft-7',
          io: 'input',
        }),
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const vaultId = parse(id, request.params.vaultId);
      await access.requireVault(request, vaultId);
      const spaces = parse(
        z.array(id).min(1).max(100),
        String(request.query.spaceIds ?? '').split(','),
      );
      for (const space of spaces) await access.requireSpace(request, vaultId, space, 'read');
      const scope = {
        ownerId: request.auth!.user._id,
        vaultId: new ObjectId(vaultId),
        spaceId: { $in: spaces.map((v) => new ObjectId(v)) },
      };
      if (
        (await store.notes.countDocuments({ ...scope, deleted: false })) +
          (await store.attachments.countDocuments({ ...scope, state: 'ready' })) >
        10000
      )
        throw vaultWriteError('Sync supports up to 10,000 selected files.', 422);
      for await (const file of store.attachments.find({ ...scope, state: 'ready' }))
        await ensureHash(file);
      return db.client.withSession((session) =>
        session.withTransaction(
          async () => {
            const files: SyncFile[] = [];
            let bytes = 0;
            for await (const note of store.notes.find({ ...scope, deleted: false }, { session })) {
              bytes += Buffer.byteLength(note.markdown);
              if (bytes > 64 * 1024 * 1024)
                throw vaultWriteError('Selected Markdown exceeds 64 MiB.', 422);
              files.push(noteFile(note));
            }
            for await (const file of store.attachments.find(
              { ...scope, state: 'ready' },
              { session },
            )) {
              if (!file.contentHash)
                throw vaultWriteError('Files changed during sync preparation. Retry.', 409);
              files.push(attachmentFile(file));
            }
            const keys = new Set<string>();
            for (const file of files) {
              const key = pathKey(file.path);
              if (keys.has(key))
                throw vaultWriteError(
                  'A note and attachment occupy the same path. Rename one before syncing.',
                  409,
                );
              keys.add(key);
            }
            return { files };
          },
          { readConcern: { level: 'snapshot' } },
        ),
      );
    },
  );
  app.get<{ Params: { vaultId: string }; Querystring: { id: string; kind: string } }>(
    '/api/vaults/:vaultId/sync/file',
    {
      ...guard,
      schema: {
        tags: ['Sync'],
        summary: 'Read one owner file and its fingerprint',
        params: paramsSchema,
        querystring: z.toJSONSchema(
          z.object({ id, kind: z.enum(['note', 'attachment']) }).strict(),
          { target: 'draft-7', io: 'input' },
        ),
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const vaultId = parse(id, request.params.vaultId),
        fileId = new ObjectId(parse(id, request.query.id));
      await access.requireVault(request, vaultId);
      const scope = {
        ownerId: request.auth!.user._id,
        vaultId: new ObjectId(vaultId),
        _id: fileId,
      };
      if (request.query.kind === 'note') {
        const note = await store.notes.findOne({ ...scope, deleted: false });
        if (!note) throw vaultWriteError('File not found.', 404);
        await access.requireSpace(request, vaultId, note.spaceId!.toHexString(), 'read');
        return { file: noteFile(note), data: Buffer.from(note.markdown).toString('base64') };
      }
      if (request.query.kind !== 'attachment') throw vaultWriteError('Invalid file kind.', 400);
      const file = await store.attachments.findOne({ ...scope, state: 'ready' });
      if (!file) throw vaultWriteError('File not found.', 404);
      await access.requireSpace(request, vaultId, file.spaceId!.toHexString(), 'read');
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of store.bucket.openDownloadStream(file._id)) {
        bytes += chunk.length;
        if (bytes > 20 * 1024 * 1024) throw vaultWriteError('Attachment exceeds 20 MiB.', 422);
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      return { file: { ...attachmentFile(file), hash: sha(data) }, data: data.toString('base64') };
    },
  );
  app.post<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId/sync/file',
    {
      ...guard,
      bodyLimit: 29 * 1024 * 1024,
      schema: {
        tags: ['Sync'],
        summary: 'Compare-and-swap one owner file; note changes are versioned',
        params: paramsSchema,
        body: syncBodyJson,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const vaultId = parse(id, request.params.vaultId);
      await access.requireVault(request, vaultId);
      const body = parse(syncBody, request.body);
      let path: string;
      try {
        path = normalizeVaultPath(body.path);
      } catch {
        throw vaultWriteError('Invalid portable file path.', 400);
      }
      if ((body.kind === 'note') !== /\.md$/i.test(path))
        throw vaultWriteError('Markdown paths must use note sync.', 400);
      const data = body.data === null ? null : Buffer.from(body.data, 'base64');
      if (
        data &&
        (data.toString('base64') !== body.data ||
          data.length > (body.kind === 'note' ? 1024 * 1024 : 20 * 1024 * 1024))
      )
        throw vaultWriteError('Invalid or oversized file data.', 400);
      let markdown = '';
      if (body.kind === 'note' && data) {
        markdown = data.toString('utf8');
        if (!Buffer.from(markdown).equals(data))
          throw vaultWriteError('Markdown must be UTF-8.', 400);
      }
      const scope = {
        ownerId: request.auth!.user._id,
        vaultId: new ObjectId(vaultId),
        pathKey: pathKey(path),
      };
      const prior = await store.attachments.findOne({ ...scope, state: 'ready' });
      if (prior) await ensureHash(prior);
      let uploadId: ObjectId | undefined;
      let replacedId: ObjectId | undefined;
      let committed = false;
      if (body.kind === 'attachment' && data) {
        uploadId = new ObjectId();
        try {
          await pipeline(
            Readable.from(data),
            store.bucket.openUploadStreamWithId(uploadId, path, {
              metadata: { ownerId: scope.ownerId, vaultId: scope.vaultId },
            }),
          );
        } catch (error) {
          await store.bucket.delete(uploadId).catch(() => undefined);
          throw error;
        }
      }
      try {
        const file = await withVaultWrite(db, scope.vaultId, scope.ownerId, async (session) => {
          await security.lockSession(request, session, false);
          const space = await access.requireSpace(request, vaultId, body.spaceId, 'write', session);
          const note = await store.notes.findOne({ ...scope, deleted: false }, { session });
          const attachment = await store.attachments.findOne({ ...scope }, { session });
          if (attachment && attachment.state !== 'ready')
            throw vaultWriteError('An attachment operation is in progress. Retry.', 409);
          const current = note ? noteFile(note) : attachment ? attachmentFile(attachment) : null;
          if (
            (note && attachment) ||
            !equals(current, body.expected) ||
            (current && current.kind !== body.kind)
          )
            throw vaultWriteError(
              'File changed on the server. Sync again to review the conflict.',
              409,
            );
          if (current)
            await access.requireSpace(request, vaultId, current.spaceId, 'write', session);
          if (body.kind === 'note') {
            if (!note && !data) return null;
            const at = new Date();
            const next: NoteDocument = note
              ? {
                  ...note,
                  path,
                  markdown: data ? markdown : note.markdown,
                  spaceId: space._id,
                  revision: note.revision + 1,
                  updatedAt: at,
                  deleted: data === null,
                }
              : {
                  _id: new ObjectId(),
                  ...scope,
                  path,
                  markdown,
                  spaceId: space._id,
                  revision: 1,
                  createdAt: at,
                  updatedAt: at,
                  deleted: false,
                  parsed: parseNote(markdown),
                  searchText: '',
                };
            next.parsed = parseNote(next.markdown);
            next.searchText = next.parsed.text;
            if (note) {
              await snapshot(
                db,
                note,
                'baseline',
                { kind: 'user', id: scope.ownerId.toHexString() },
                session,
              );
              await store.notes.replaceOne({ _id: note._id }, next, { session });
            } else await store.notes.insertOne(next, { session });
            await snapshot(
              db,
              next,
              data === null ? 'delete' : note ? 'update' : 'create',
              { kind: 'user', id: scope.ownerId.toHexString() },
              session,
            );
            await recordNoteChange(
              db,
              scope.ownerId,
              scope.vaultId,
              next._id,
              data === null ? 'delete' : note ? 'update' : 'create',
              session,
              space._id,
            );
            return data === null ? null : noteFile(next);
          }
          if (attachment) {
            await store.attachments.deleteOne({ _id: attachment._id }, { session });
            replacedId = attachment._id;
          }
          if (!data) return null;
          const next: AttachmentDocument = {
            _id: uploadId!,
            ...scope,
            path,
            spaceId: space._id,
            size: data.length,
            mimeType: 'application/octet-stream',
            state: 'ready',
            createdAt: new Date(),
            contentHash: sha(data),
            revision: (attachment?.revision ?? 0) + 1,
          };
          await store.attachments.insertOne(next, { session });
          return attachmentFile(next);
        });
        committed = true;
        if (replacedId) await store.bucket.delete(replacedId).catch(() => undefined);
        return { file };
      } finally {
        if (!committed && uploadId) await store.bucket.delete(uploadId).catch(() => undefined);
      }
    },
  );
}
