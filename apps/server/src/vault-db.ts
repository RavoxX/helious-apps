import { GridFSBucket, ObjectId, type Db } from 'mongodb';
import type { ParsedNote } from '@helious/core';

export interface VaultDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  name: string;
  state: 'active' | 'deleting';
  createdAt: Date;
  updatedAt: Date;
  writeRevision?: number;
  spaceSchema?: number;
}
export interface NoteDocument {
  spaceId?: ObjectId;
  deleted?: boolean;
  _id: ObjectId;
  vaultId: ObjectId;
  ownerId: ObjectId;
  path: string;
  pathKey: string;
  markdown: string;
  parsed: ParsedNote;
  searchText: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface AttachmentDocument {
  contentHash?: string;
  revision?: number;
  spaceId?: ObjectId;
  _id: ObjectId;
  vaultId: ObjectId;
  ownerId: ObjectId;
  path: string;
  pathKey: string;
  mimeType: string;
  size: number;
  state: 'uploading' | 'ready' | 'deleting';
  createdAt: Date;
}
export function vaultCollections(db: Db) {
  return {
    vaults: db.collection<VaultDocument>('vaults'),
    notes: db.collection<NoteDocument>('notes'),
    attachments: db.collection<AttachmentDocument>('attachmentFiles'),
    bucket: new GridFSBucket(db, { bucketName: 'attachments' }),
    spaces: db.collection<SpaceDocument>('spaces'),
    versions: db.collection<NoteVersionDocument>('note_versions'),
  };
}
export async function initializeVaultDatabase(db: Db) {
  const store = vaultCollections(db);
  await Promise.all([
    db.collection('note_changes').createIndex({ ownerId: 1, vaultId: 1, at: 1 }),
    store.vaults.createIndex({ ownerId: 1, state: 1 }),
    store.notes.createIndex(
      { vaultId: 1, pathKey: 1 },
      { unique: true, name: 'active_note_path', partialFilterExpression: { deleted: false } },
    ),
    store.spaces.createIndex({ ownerId: 1, vaultId: 1, key: 1 }, { unique: true }),
    store.notes.createIndex({ ownerId: 1, vaultId: 1, spaceId: 1, deleted: 1 }),
    store.versions.createIndex({ noteId: 1, revision: 1 }, { unique: true }),
    store.versions.createIndex({ ownerId: 1, vaultId: 1, spaceId: 1, noteId: 1, revision: -1 }),
    store.notes.createIndex({ ownerId: 1, vaultId: 1, updatedAt: -1 }),
    store.notes.createIndex(
      { ownerId: 1, vaultId: 1, searchText: 'text' },
      { default_language: 'none', name: 'note_fulltext' },
    ),
    store.notes.createIndex({ vaultId: 1, 'parsed.tags': 1 }),
    store.attachments.createIndex({ vaultId: 1, pathKey: 1 }, { unique: true }),
  ]);
  // Keep the new active-note constraint in place before removing the legacy index.
  const indexes = await store.notes.listIndexes().toArray();
  if (indexes.some((index) => index.name === 'vaultId_1_pathKey_1')) {
    try {
      await store.notes.dropIndex('vaultId_1_pathKey_1');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 27)) throw error;
    }
  }
  return store;
}
export type VaultStore = ReturnType<typeof vaultCollections>;

export interface SpaceDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  vaultId: ObjectId;
  key: string;
  name: string;
  kind: 'personal' | 'code' | 'custom';
  agentAccess: 'none' | 'read' | 'read-write';
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface NoteVersionDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  vaultId: ObjectId;
  noteId: ObjectId;
  spaceId: ObjectId;
  revision: number;
  path: string;
  markdown: string;
  action: 'baseline' | 'create' | 'update' | 'move' | 'restore' | 'delete';
  actor: { kind: 'user' | 'agent' | 'migration'; id: string };
  recordedAt: Date;
}
