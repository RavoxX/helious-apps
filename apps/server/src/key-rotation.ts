import type { Db } from 'mongodb';
import type { KeyRing } from './encryption.js';
import { collections } from './db.js';
import { appendAudit, ensureAuditHead } from './secret-audit.js';
import {
  securityCollections,
  secretContext,
  totpContext,
  enrollmentContext,
} from './security-db.js';
import { withVaultWrite } from './vault-writes.js';
/** Rewrap data keys only. CAS protects concurrent credential updates and rotations. */
export async function rotateKeys(db: Db, ring: KeyRing, apply = false) {
  const store = securityCollections(db),
    accounts = collections(db);
  const counts = { checked: 0, rewrapped: 0, skipped: 0 };
  for await (const record of store.secrets.find({
    state: 'active',
    encrypted: { $exists: true },
  })) {
    counts.checked++;
    const plain = ring.decrypt(record.encrypted!, secretContext(record));
    plain.fill(0);
    if (record.encrypted!.keyId === ring.activeId) continue;
    const encrypted = ring.rewrap(record.encrypted!, secretContext(record));
    if (!apply) {
      counts.rewrapped++;
      continue;
    }
    await ensureAuditHead(db, record.ownerId);
    const changed = await withVaultWrite(db, record.vaultId, record.ownerId, async (session) => {
      const result = await store.secrets.updateOne(
        {
          _id: record._id,
          revision: record.revision,
          state: 'active',
          'encrypted.wrappedKey.tag': record.encrypted!.wrappedKey.tag,
        },
        { $set: { encrypted } },
        { session },
      );
      if (!result.modifiedCount) {
        return false;
      }
      await appendAudit(
        db,
        {
          ownerId: record.ownerId,
          actor: { kind: 'system', id: 'key-rotation' },
          ip: 'local',
          action: 'key.rotate',
          outcome: 'success',
          vaultId: record.vaultId,
          spaceId: record.spaceId,
          secretId: record._id,
        },
        session,
      );
      return true;
    });
    if (changed) counts.rewrapped++;
    else counts.skipped++;
  }
  for (const kind of ['credentials', 'enrollments'] as const) {
    const cursor =
      kind === 'credentials'
        ? store.credentials.find({})
        : store.enrollments.find({ expiresAt: { $gt: new Date() } });
    for await (const record of cursor) {
      counts.checked++;
      const ownerId = 'userId' in record ? record.userId : record._id;
      const context =
        'userId' in record ? enrollmentContext(ownerId, record._id) : totpContext(ownerId);
      const plain = ring.decrypt(record.encrypted, context);
      plain.fill(0);
      if (record.encrypted.keyId === ring.activeId) continue;
      const encrypted = ring.rewrap(record.encrypted, context);
      if (!apply) {
        counts.rewrapped++;
        continue;
      }
      await ensureAuditHead(db, ownerId);
      const changed = await db.client.withSession((session) =>
        session.withTransaction(async () => {
          await accounts.users.updateOne(
            { _id: ownerId },
            { $inc: { securityRevision: 1 } },
            { session },
          );
          const result = await db
            .collection(kind === 'credentials' ? 'security_credentials' : 'totp_enrollments')
            .updateOne(
              { _id: record._id, 'encrypted.wrappedKey.tag': record.encrypted.wrappedKey.tag },
              { $set: { encrypted } },
              { session },
            );
          if (!result.modifiedCount) {
            return false;
          }
          await appendAudit(
            db,
            {
              ownerId,
              actor: { kind: 'system', id: 'key-rotation' },
              ip: 'local',
              action: 'key.rotate',
              outcome: 'success',
            },
            session,
          );
          return true;
        }),
      );
      if (changed) counts.rewrapped++;
      else counts.skipped++;
    }
  }
  return { mode: apply ? 'apply' : 'dry-run', ...counts };
}
