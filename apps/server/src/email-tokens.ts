import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';

export const EMAIL_TOKEN_MS = 30 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
export type EmailTokenType = 'verify-email' | 'reset-password' | 'change-email';
export interface EmailToken {
  _id: string;
  userId: ObjectId;
  type: EmailTokenType;
  hash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  targetEmail?: string;
}
interface EmailRate {
  _id: string;
  attempts: { at: Date; id: string }[];
  expiresAt: Date;
}
export const emailTokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function newEmailToken(now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    hash: emailTokenHash(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + EMAIL_TOKEN_MS),
  };
}
export async function initializeEmailTokens(db: Db) {
  await Promise.all([
    db.collection<EmailToken>('email_tokens').createIndex({ hash: 1 }, { unique: true }),
    db
      .collection<EmailToken>('email_tokens')
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db
      .collection<EmailRate>('email_rates')
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}
export class EmailTokens {
  constructor(private readonly db: Db) {}
  async issue(userId: ObjectId, type: EmailTokenType, targetEmail?: string, now = new Date()) {
    const fresh = newEmailToken(now);
    // One replaceable slot per account/type: concurrent re-requests cannot leave two active tokens.
    await this.db.collection<EmailToken>('email_tokens').replaceOne(
      { _id: `${userId.toHexString()}:${type}` },
      {
        userId,
        type,
        hash: fresh.hash,
        createdAt: fresh.createdAt,
        expiresAt: fresh.expiresAt,
        usedAt: null,
        ...(targetEmail ? { targetEmail } : {}),
      },
      { upsert: true },
    );
    return fresh;
  }
  async inspect(token: string, types: EmailTokenType[], now = new Date()) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = emailTokenHash(token);
    const collection = this.db.collection<EmailToken>('email_tokens');
    const candidate = await collection.findOne({ hash, type: { $in: types } });
    const equal = timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(candidate?.hash ?? '0'.repeat(64), 'hex'),
    );
    return equal && candidate && candidate.usedAt === null && candidate.expiresAt > now
      ? candidate
      : null;
  }
  async consume(token: string, types: EmailTokenType[], now = new Date()) {
    const candidate = await this.inspect(token, types, now);
    if (!candidate) return null;
    return this.db.collection<EmailToken>('email_tokens').findOneAndUpdate(
      {
        _id: candidate._id,
        hash: candidate.hash,
        type: { $in: types },
        usedAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { usedAt: now } },
      { returnDocument: 'after' },
    );
  }
  async allowEmail(address: string, now = new Date()) {
    const id = randomUUID();
    const rate = await this.db.collection<EmailRate>('email_rates').findOneAndUpdate(
      { _id: emailTokenHash(address.toLowerCase()) },
      [
        {
          $set: {
            attempts: {
              $filter: {
                input: { $ifNull: ['$attempts', []] },
                as: 'attempt',
                cond: { $gt: ['$$attempt.at', new Date(now.getTime() - RATE_WINDOW_MS)] },
              },
            },
          },
        },
        {
          $set: {
            attempts: {
              $cond: [
                { $lt: [{ $size: '$attempts' }, 3] },
                { $concatArrays: ['$attempts', [{ at: now, id }]] },
                '$attempts',
              ],
            },
            expiresAt: new Date(now.getTime() + RATE_WINDOW_MS),
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
    return rate?.attempts.some((attempt) => attempt.id === id) ?? false;
  }
}
