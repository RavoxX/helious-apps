import { ObjectId, type Db } from 'mongodb';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseMarkdown } from '@helious/core';
import { vaultCollections, type NoteVersionDocument } from './vault-db.js';
import type { VaultAccess } from './vault-access.js';
import { snapshot } from './spaces.js';
import { withVaultWrite, vaultWriteError } from './vault-writes.js';
import { recordNoteChange } from './insights.js';
const id = { type: 'string', pattern: '^[a-f0-9]{24}$' };
const params = {
  type: 'object',
  required: ['vaultId', 'noteId'],
  properties: { vaultId: id, noteId: id, version: { type: 'integer', minimum: 1 } },
};
const metadata = (version: NoteVersionDocument) => ({
  revision: version.revision,
  path: version.path,
  spaceId: version.spaceId.toHexString(),
  action: version.action,
  actor: version.actor,
  recordedAt: version.recordedAt.toISOString(),
});
export async function registerHistoryRoutes(
  app: FastifyInstance,
  db: Db,
  guard: { preHandler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> },
  access: VaultAccess,
) {
  const store = vaultCollections(db);
  const schema = (summary: string, extra = {}) => ({
    tags: ['History'],
    summary,
    security: [{ session: [] }],
    params,
    ...extra,
  });
  async function head(request: FastifyRequest, vaultId: string, noteId: string) {
    await access.requireVault(request, vaultId);
    const note = await store.notes.findOne({
      ...(await access.scope(request, vaultId, 'read', undefined, false)),
      _id: new ObjectId(noteId),
    });
    if (!note) throw vaultWriteError('Note not found', 404);
    return note;
  }
  app.get<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId/deleted-notes',
    {
      ...guard,
      schema: schema('List up to 100 recently deleted notes in permitted spaces', {
        params: { ...params, required: ['vaultId'] },
        querystring: { type: 'object', properties: { spaceId: id }, additionalProperties: false },
      }),
    },
    async (request) => {
      await access.requireVault(request, request.params.vaultId);
      const notes = await store.notes
        .find(
          { ...(await access.scope(request, request.params.vaultId)), deleted: true },
          { projection: { path: 1, revision: 1, spaceId: 1, updatedAt: 1 } },
        )
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray();
      return {
        notes: notes.map((note) => ({
          id: note._id.toHexString(),
          path: note.path,
          revision: note.revision,
          spaceId: note.spaceId!.toHexString(),
          deletedAt: note.updatedAt.toISOString(),
        })),
      };
    },
  );
  app.get<{
    Params: { vaultId: string; noteId: string };
    Querystring: { offset?: number; limit?: number };
  }>(
    '/api/vaults/:vaultId/notes/:noteId/history',
    {
      ...guard,
      schema: schema(
        'List retained revision metadata; both current and historical spaces must be permitted',
        {
          querystring: {
            type: 'object',
            properties: {
              offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
              limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
            },
            additionalProperties: false,
          },
        },
      ),
    },
    async (request) => {
      const note = await head(request, request.params.vaultId, request.params.noteId);
      const scope = {
        ...(await access.scope(request, request.params.vaultId, 'read', undefined, false)),
        noteId: note._id,
      };
      const [versions, total] = await Promise.all([
        store.versions
          .find(scope, { projection: { markdown: 0 } })
          .sort({ revision: -1 })
          .skip(request.query.offset ?? 0)
          .limit(request.query.limit ?? 25)
          .toArray(),
        store.versions.countDocuments(scope),
      ]);
      return {
        versions: versions.map(metadata),
        total,
        currentRevision: note.revision,
        deleted: !!note.deleted,
        currentPath: note.path,
        currentSpaceId: note.spaceId!.toHexString(),
      };
    },
  );
  app.get<{ Params: { vaultId: string; noteId: string; version: number } }>(
    '/api/vaults/:vaultId/notes/:noteId/history/:version',
    { ...guard, schema: schema('Read the content of one permitted revision') },
    async (request) => {
      const note = await head(request, request.params.vaultId, request.params.noteId);
      const version = await store.versions.findOne({
        ...(await access.scope(request, request.params.vaultId, 'read', undefined, false)),
        noteId: note._id,
        revision: request.params.version,
      });
      if (!version) throw vaultWriteError('Revision not found', 404);
      return { version: { ...metadata(version), markdown: version.markdown } };
    },
  );
  app.post<{
    Params: { vaultId: string; noteId: string; version: number };
    Body: { revision: number };
  }>(
    '/api/vaults/:vaultId/notes/:noteId/history/:version/restore',
    {
      ...guard,
      schema: schema(
        'Restore content and its original space as a new revision, retaining the current path',
        {
          body: {
            type: 'object',
            required: ['revision'],
            properties: { revision: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
          },
        },
      ),
    },
    async (request) => {
      await access.requireVault(request, request.params.vaultId);
      return withVaultWrite(
        db,
        new ObjectId(request.params.vaultId),
        access.owner(request),
        async (session) => {
          const scope = await access.scope(
            request,
            request.params.vaultId,
            'write',
            session,
            false,
          );
          const current = await store.notes.findOne(
            { ...scope, _id: new ObjectId(request.params.noteId) },
            { session },
          );
          if (!current) throw vaultWriteError('Note not found', 404);
          if (current.revision !== request.body.revision)
            throw vaultWriteError('This note changed elsewhere. Refresh history before restoring.');
          const version = await store.versions.findOne(
            { ...scope, noteId: current._id, revision: request.params.version },
            { session },
          );
          if (!version || version.action === 'delete')
            throw vaultWriteError('Restorable revision not found', 404);
          await access.requireSpace(
            request,
            request.params.vaultId,
            version.spaceId.toHexString(),
            'write',
            session,
          );
          await snapshot(
            db,
            current,
            'baseline',
            { kind: access.principal(request).kind, id: access.principal(request).actorId },
            session,
          );
          const parsed = parseMarkdown(version.markdown);
          const updated = (await store.notes.findOneAndUpdate(
            { _id: current._id, revision: current.revision },
            {
              $set: {
                markdown: version.markdown,
                parsed,
                searchText: `${current.path} ${parsed.title ?? ''} ${parsed.text}`,
                spaceId: version.spaceId,
                deleted: false,
                updatedAt: new Date(),
              },
              $inc: { revision: 1 },
            },
            { session, returnDocument: 'after' },
          ))!;
          await snapshot(
            db,
            updated,
            'restore',
            { kind: access.principal(request).kind, id: access.principal(request).actorId },
            session,
          );
          await recordNoteChange(
            db,
            updated.ownerId,
            updated.vaultId,
            updated._id,
            'restore',
            session,
            updated.spaceId,
          );
          return {
            ok: true,
            noteId: updated._id.toHexString(),
            revision: updated.revision,
            path: updated.path,
            spaceId: updated.spaceId!.toHexString(),
          };
        },
      );
    },
  );
}
