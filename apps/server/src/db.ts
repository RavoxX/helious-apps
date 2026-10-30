import { MongoClient, ObjectId, type Db } from 'mongodb';
import { migrateVerifiedAccounts } from './migrations.js';
import { initializeEmailTokens } from './email-tokens.js';

export interface UserDocument {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  role: 'user' | 'admin';
  createdAt: Date;
  emailVerified: boolean;
  verifiedAt?: Date;
  pendingEmail?: string;
  authVersion: number;
  totpEnabled?: boolean;
  securityRevision?: number;
  state?: 'active' | 'deleting' | 'suspended';
  policyAcceptance?: {
    minimumAge: number;
    ageSelfDeclared: boolean;
    termsVersion?: string;
    termsUrl?: string;
    privacyUrl?: string;
    acceptedAt: Date;
  };
}

export interface SessionDocument {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  createdAt: Date;
  rotatedAt: Date;
  expiresAt: Date;
  userAgent: string;
  authVersion?: number;
  mfaVerifiedAt?: Date;
  securityUse?: number;
}

interface LoginAttempt {
  _id: string;
  failures: number;
  lockedUntil: Date;
  expiresAt: Date;
}

interface SettingsDocument {
  _id: string;
  adminId?: ObjectId;
  registrationOpen?: boolean;
  revision?: number;
}

export function collections(db: Db) {
  return {
    users: db.collection<UserDocument>('users'),
    sessions: db.collection<SessionDocument>('sessions'),
    loginAttempts: db.collection<LoginAttempt>('loginAttempts'),
    settings: db.collection<SettingsDocument>('settings'),
  };
}

export async function initializeDatabase(db: Db) {
  await migrateVerifiedAccounts(db);
  await initializeEmailTokens(db);
  const store = collections(db);
  await Promise.all([
    store.users.createIndex({ email: 1 }, { unique: true }),
    store.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    store.sessions.createIndex({ userId: 1 }),
    store.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    store.loginAttempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
  return store;
}

export async function connectDatabase(uri: string) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  return { client, db: client.db() };
}

export type Store = ReturnType<typeof collections>;
