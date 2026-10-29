import { createHash } from 'node:crypto';
import { MongoServerError, ObjectId, type ClientSession, type Db } from 'mongodb';
export interface AuditEvent {
  ownerId: ObjectId;
  actor: { kind: 'user' | 'agent' | 'system'; id: string };
  ip: string;
  action:
    | 'secret.create'
    | 'secret.update'
    | 'secret.delete'
    | 'secret.read'
    | 'secret.list'
    | 'secret.approve'
    | 'secret.request'
    | 'mfa.enable'
    | 'mfa.disable'
    | 'mfa.recovery'
    | 'key.rotate';
  outcome: 'success' | 'denied' | 'pending' | 'approved' | 'rejected' | 'error';
  vaultId?: ObjectId;
  spaceId?: ObjectId;
  secretId?: ObjectId;
  approvalId?: ObjectId;
}
interface AuditHead {
  _id: ObjectId;
  seq: number;
  hash: string;
}
export interface AuditRecord extends AuditEvent {
  _id: ObjectId;
  seq: number;
  at: Date;
  previousHash: string;
  hash: string;
}
export const auditHash = (entry: Omit<AuditRecord, '_id' | 'hash'>) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        ownerId: entry.ownerId.toHexString(),
        seq: entry.seq,
        at: entry.at.toISOString(),
        previousHash: entry.previousHash,
        actor: entry.actor,
        ip: entry.ip,
        action: entry.action,
        outcome: entry.outcome,
        vaultId: entry.vaultId?.toHexString() ?? null,
        spaceId: entry.spaceId?.toHexString() ?? null,
        secretId: entry.secretId?.toHexString() ?? null,
        approvalId: entry.approvalId?.toHexString() ?? null,
      }),
    )
    .digest('hex');
export async function ensureAuditHead(db: Db, ownerId: ObjectId) {
  try {
    await db
      .collection<AuditHead>('secret_audit_heads')
      .updateOne(
        { _id: ownerId },
        { $setOnInsert: { seq: 0, hash: '0'.repeat(64) } },
        { upsert: true },
      );
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
  }
}
export async function appendAudit(
  db: Db,
  event: AuditEvent,
  session?: ClientSession,
): Promise<void> {
  if (!session) {
    await ensureAuditHead(db, event.ownerId);
    await db.client.withSession((session) =>
      session.withTransaction(() => appendAudit(db, event, session)),
    );
    return;
  }
  const heads = db.collection<AuditHead>('secret_audit_heads');
  const head = await heads.findOne({ _id: event.ownerId }, { session });
  if (!head) throw new Error('Audit sequence unavailable');
  const record = {
    ...event,
    _id: new ObjectId(),
    seq: head.seq + 1,
    at: new Date(),
    previousHash: head.hash,
  };
  const hash = auditHash(record);
  const update = await heads.updateOne(
    { _id: head._id, seq: head.seq },
    { $set: { seq: record.seq, hash } },
    { session },
  );
  if (!update.matchedCount) throw new Error('Audit sequence conflict');
  await db.collection<AuditRecord>('secret_audit').insertOne({ ...record, hash }, { session });
}
