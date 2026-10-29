import { ObjectId, type Db } from 'mongodb';
import type { Envelope, KeyRing } from './encryption.js';
export interface TotpDocument {
  _id: ObjectId;
  encrypted: Envelope;
  lastStep: number;
  recoveryHashes: string[];
  revision: number;
}
export interface EnrollmentDocument {
  _id: ObjectId;
  userId: ObjectId;
  sessionId: ObjectId;
  authVersion: number;
  encrypted: Envelope;
  expiresAt: Date;
}
export interface SecretDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  vaultId: ObjectId;
  spaceId: ObjectId;
  name: string;
  nameKey: string;
  kind: 'password' | 'api-key' | 'ssh-key' | 'env' | 'other';
  agentAccess: 'none' | 'read';
  requireApproval: boolean;
  encrypted?: Envelope;
  state: 'active' | 'deleted';
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface ApprovalDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  vaultId: ObjectId;
  spaceId: ObjectId;
  secretId: ObjectId;
  agentId: string;
  secretRevision: number;
  spaceRevision: number;
  ownerAuthVersion: number;
  state: 'pending' | 'approved' | 'denied' | 'used';
  createdAt: Date;
  expiresAt: Date;
  decidedAt?: Date;
  usedAt?: Date;
  approverId?: ObjectId;
}
export const secretContext = (
  secret: Pick<SecretDocument, '_id' | 'ownerId' | 'vaultId' | 'spaceId'>,
) => `secret:${secret.ownerId}:${secret.vaultId}:${secret.spaceId}:${secret._id}`;
export const totpContext = (userId: ObjectId) => `totp:${userId}`;
export const enrollmentContext = (userId: ObjectId, id: ObjectId) => `totp-pending:${userId}:${id}`;
export function securityCollections(db: Db) {
  return {
    credentials: db.collection<TotpDocument>('security_credentials'),
    enrollments: db.collection<EnrollmentDocument>('totp_enrollments'),
    secrets: db.collection<SecretDocument>('secrets'),
    approvals: db.collection<ApprovalDocument>('secret_approvals'),
  };
}
export async function initializeSecurityDatabase(db: Db, ring: KeyRing) {
  const store = securityCollections(db);
  await Promise.all([
    store.enrollments.createIndex({ userId: 1 }, { unique: true }),
    store.enrollments.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    store.secrets.createIndex({ ownerId: 1, vaultId: 1, spaceId: 1, state: 1 }),
    store.secrets.createIndex(
      { ownerId: 1, vaultId: 1, nameKey: 1 },
      { unique: true, partialFilterExpression: { state: 'active' } },
    ),
    store.approvals.createIndex({ ownerId: 1, state: 1, expiresAt: 1 }),
    store.approvals.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('security_attempts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('secret_audit').createIndex({ ownerId: 1, seq: 1 }, { unique: true }),
    db.collection('secret_audit').createIndex({ ownerId: 1, vaultId: 1, at: -1 }),
  ]);
  const sets = await Promise.all([
    store.secrets.distinct('encrypted.keyId', { encrypted: { $exists: true } }),
    store.credentials.distinct('encrypted.keyId'),
    store.enrollments.distinct('encrypted.keyId', { expiresAt: { $gt: new Date() } }),
  ]);
  if (sets.flat().some((id) => typeof id !== 'string' || !ring.has(id)))
    throw new Error(
      'The configured encryption key ring cannot open stored records. Restore required previous master keys before starting.',
    );
}
