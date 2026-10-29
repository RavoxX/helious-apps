import { MongoServerError, ObjectId, type ClientSession, type Db } from 'mongodb';
import { canAccessSpace, type KnowledgePrincipal } from '@helious/core';
import {
  vaultCollections,
  type NoteDocument,
  type NoteVersionDocument,
  type SpaceDocument,
} from './vault-db.js';

export const spaceResponse = (space: SpaceDocument) => ({
  id: space._id.toHexString(),
  name: space.name,
  kind: space.kind,
  agentAccess: space.agentAccess,
  revision: space.revision,
});
export const policy = (space: SpaceDocument) => ({
  ...spaceResponse(space),
  ownerId: space.ownerId.toHexString(),
  vaultId: space.vaultId.toHexString(),
});
export async function ensureDefaultSpaces(
  db: Db,
  ownerId: ObjectId,
  vaultId: ObjectId,
  session?: ClientSession,
) {
  const store = vaultCollections(db);
  for (const kind of ['personal', 'code'] as const) {
    const now = new Date();
    try {
      await store.spaces.updateOne(
        { ownerId, vaultId, key: kind },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            ownerId,
            vaultId,
            key: kind,
            kind,
            name: kind === 'personal' ? 'Personal' : 'Code',
            agentAccess: kind === 'personal' ? 'none' : 'read-write',
            revision: 1,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true, session },
      );
    } catch (error) {
      if (session || !(error instanceof MongoServerError) || error.code !== 11000) throw error;
    }
  }
  return (await store.spaces.findOne({ ownerId, vaultId, key: 'personal' }, { session }))!;
}
/** Idempotent, conservative migration: all unclassified content starts in Personal. */
export async function migrateSpaces(db: Db) {
  const store = vaultCollections(db);
  for await (const vault of store.vaults.find({ state: 'active', spaceSchema: { $ne: 5 } })) {
    const personal = await ensureDefaultSpaces(db, vault.ownerId, vault._id);
    const scope = { ownerId: vault.ownerId, vaultId: vault._id };
    await store.notes.updateMany(
      { ...scope, spaceId: { $exists: false } },
      { $set: { spaceId: personal._id } },
    );
    await store.notes.updateMany(
      { ...scope, deleted: { $exists: false } },
      { $set: { deleted: false } },
    );
    await store.attachments.updateMany(
      { ...scope, spaceId: { $exists: false } },
      { $set: { spaceId: personal._id } },
    );
    await db
      .collection('note_changes')
      .updateMany({ ...scope, spaceId: { $exists: false } }, { $set: { spaceId: personal._id } });
    for await (const note of store.notes.find(scope))
      await snapshot(db, note, 'baseline', { kind: 'migration', id: 'phase-5' });
    await store.vaults.updateOne({ _id: vault._id }, { $set: { spaceSchema: 5 } });
  }
}
export async function snapshot(
  db: Db,
  note: NoteDocument,
  action: NoteVersionDocument['action'],
  actor: NoteVersionDocument['actor'],
  session?: ClientSession,
) {
  if (!note.spaceId) throw new Error('Cannot version an unclassified note');
  await vaultCollections(db).versions.updateOne(
    { noteId: note._id, revision: note.revision },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        ownerId: note.ownerId,
        vaultId: note.vaultId,
        noteId: note._id,
        spaceId: note.spaceId,
        revision: note.revision,
        path: note.path,
        markdown: note.markdown,
        action,
        actor,
        recordedAt: new Date(),
      },
    },
    { upsert: true, session },
  );
}
export async function readableSpaces(
  db: Db,
  principal: KnowledgePrincipal,
  vaultId: ObjectId,
  operation: 'read' | 'write' = 'read',
  session?: ClientSession,
) {
  const spaces = await vaultCollections(db)
    .spaces.find({ ownerId: new ObjectId(principal.ownerId), vaultId }, { session })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return spaces.filter((space) => canAccessSpace(principal, policy(space), operation));
}
