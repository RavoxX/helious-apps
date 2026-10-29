import type { Db } from 'mongodb';

/** Idempotent legacy migration; explicit false values on new accounts are never upgraded. */
export async function migrateVerifiedAccounts(db: Db) {
  await db.collection('users').updateMany({ emailVerified: { $exists: false } }, [
    {
      $set: {
        emailVerified: true,
        verifiedAt: { $ifNull: ['$createdAt', new Date()] },
        authVersion: { $ifNull: ['$authVersion', 0] },
      },
    },
  ]);
}
