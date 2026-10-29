import { MongoServerError, ObjectId, type ClientSession, type Db } from 'mongodb';
import { vaultCollections } from './vault-db.js';

export const vaultWriteError = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
/** Serializes note writers through the vault document and commits each operation atomically. */
export async function withVaultWrite<T>(
  db: Db,
  vaultId: ObjectId,
  ownerId: ObjectId,
  write: (session: ClientSession) => Promise<T>,
  duplicateMessage = 'A note already exists at this path',
): Promise<T> {
  try {
    return await db.client.withSession((session) =>
      session.withTransaction(
        async () => {
          const locked = await vaultCollections(db).vaults.updateOne(
            { _id: vaultId, ownerId, state: 'active' },
            { $inc: { writeRevision: 1 }, $set: { updatedAt: new Date() } },
            { session },
          );
          if (!locked.matchedCount) throw vaultWriteError('Vault not found', 404);
          return write(session);
        },
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          maxCommitTimeMS: 10000,
        },
      ),
    );
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 20)
      throw vaultWriteError(
        'Note writes require a MongoDB replica set. Follow the database setup guide.',
        503,
      );
    if (error instanceof MongoServerError && error.code === 11000)
      throw vaultWriteError(duplicateMessage);
    throw error;
  }
}
