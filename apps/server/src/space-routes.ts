import { ObjectId, type Db } from 'mongodb';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { VaultAccess } from './vault-access.js';
import { vaultCollections, type SpaceDocument } from './vault-db.js';
import { spaceResponse } from './spaces.js';
import { withVaultWrite, vaultWriteError } from './vault-writes.js';
const withSpaceWrite: typeof withVaultWrite = (db, vaultId, ownerId, write) =>
  withVaultWrite(db, vaultId, ownerId, write, 'A space with this name already exists.');
const id = { type: 'string', pattern: '^[a-f0-9]{24}$' };
const params = { type: 'object', required: ['vaultId'], properties: { vaultId: id, spaceId: id } };
const fields = {
  name: { type: 'string', minLength: 1, maxLength: 80 },
  agentAccess: { type: 'string', enum: ['none', 'read', 'read-write'] },
  revision: { type: 'integer', minimum: 1 },
};
const body = z
  .object({
    name: z.string().trim().min(1).max(80),
    agentAccess: z.enum(['none', 'read', 'read-write']).default('none'),
  })
  .strict();
export async function registerSpaceRoutes(
  app: FastifyInstance,
  db: Db,
  guard: { preHandler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> },
  access: VaultAccess,
) {
  const store = vaultCollections(db);
  const schema = (summary: string, extra = {}) => ({
    tags: ['Spaces'],
    summary,
    security: [{ session: [] }],
    params,
    ...extra,
  });
  app.get<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId/spaces',
    { ...guard, schema: schema('List spaces visible to the authenticated principal') },
    async (request) => {
      await access.requireVault(request, request.params.vaultId);
      return {
        spaces: (await access.allowed(request, request.params.vaultId)).map(spaceResponse),
        canManage: access.principal(request).kind === 'user',
      };
    },
  );
  app.post<{ Params: { vaultId: string } }>(
    '/api/vaults/:vaultId/spaces',
    {
      ...guard,
      schema: schema('Create a custom space; agent access defaults to none', {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: fields.name, agentAccess: fields.agentAccess },
          additionalProperties: false,
        },
      }),
    },
    async (request, reply) => {
      access.requireOwner(request);
      await access.requireVault(request, request.params.vaultId);
      const parsed = body.safeParse(request.body);
      if (!parsed.success)
        throw vaultWriteError('Enter a space name of 1–80 characters and a valid policy.', 400);
      const now = new Date();
      const space: SpaceDocument = {
        _id: new ObjectId(),
        ...access.base(request, request.params.vaultId),
        key: parsed.data.name.normalize('NFC').toLowerCase(),
        ...parsed.data,
        kind: 'custom',
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      await withSpaceWrite(db, space.vaultId, space.ownerId, async (session) => {
        await store.spaces.insertOne(space, { session });
      });
      return reply.code(201).send({ space: spaceResponse(space) });
    },
  );
  app.patch<{ Params: { vaultId: string; spaceId: string } }>(
    '/api/vaults/:vaultId/spaces/:spaceId',
    {
      ...guard,
      schema: schema('Change a space policy or rename a custom space with an expected revision', {
        body: {
          type: 'object',
          required: ['revision'],
          properties: fields,
          additionalProperties: false,
        },
      }),
    },
    async (request) => {
      access.requireOwner(request);
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          agentAccess: z.enum(['none', 'read', 'read-write']).optional(),
          revision: z.number().int().positive(),
        })
        .strict()
        .safeParse(request.body);
      if (!parsed.success) throw vaultWriteError('Check the submitted fields.', 400);
      return withSpaceWrite(
        db,
        new ObjectId(request.params.vaultId),
        access.owner(request),
        async (session) => {
          const space = await access.requireSpace(
            request,
            request.params.vaultId,
            request.params.spaceId,
            'write',
            session,
          );
          if (space.revision !== parsed.data.revision)
            throw vaultWriteError('This space changed elsewhere. Refresh before saving.');
          const name = parsed.data.name ?? space.name;
          if (space.kind !== 'custom' && name !== space.name)
            throw vaultWriteError('Personal and Code keep their built-in names.', 400);
          const updated = await store.spaces.findOneAndUpdate(
            { _id: space._id, revision: space.revision },
            {
              $set: {
                name,
                key: space.kind === 'custom' ? name.normalize('NFC').toLowerCase() : space.key,
                agentAccess: parsed.data.agentAccess ?? space.agentAccess,
                updatedAt: new Date(),
              },
              $inc: { revision: 1 },
            },
            { session, returnDocument: 'after' },
          );
          return { space: spaceResponse(updated!) };
        },
      );
    },
  );
  app.delete<{ Params: { vaultId: string; spaceId: string } }>(
    '/api/vaults/:vaultId/spaces/:spaceId',
    { ...guard, schema: schema('Delete a never-used custom space') },
    async (request) => {
      access.requireOwner(request);
      return withSpaceWrite(
        db,
        new ObjectId(request.params.vaultId),
        access.owner(request),
        async (session) => {
          const space = await access.requireSpace(
            request,
            request.params.vaultId,
            request.params.spaceId,
            'write',
            session,
          );
          if (space.kind !== 'custom') throw vaultWriteError('Built-in spaces cannot be deleted.');
          const scope = { ...access.base(request, request.params.vaultId), spaceId: space._id };
          if (
            (await store.notes.countDocuments(scope, { session, limit: 1 })) ||
            (await store.attachments.countDocuments(scope, { session, limit: 1 })) ||
            (await store.versions.countDocuments(scope, { session, limit: 1 })) ||
            (await db
              .collection('secrets')
              .countDocuments({ ...scope, state: 'active' }, { session, limit: 1 }))
          )
            throw vaultWriteError(
              'This space contains notes, attachments, secrets or retained history and cannot be deleted.',
            );
          await store.spaces.deleteOne({ _id: space._id }, { session });
          return { ok: true };
        },
      );
    },
  );
}
