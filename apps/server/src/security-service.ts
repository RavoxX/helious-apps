import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { ObjectId, type ClientSession, type Db } from 'mongodb';
import type { FastifyRequest } from 'fastify';
import { collections, type UserDocument } from './db.js';
import type { KeyRing } from './encryption.js';
import { appendAudit, ensureAuditHead } from './secret-audit.js';
import { enrollmentContext, securityCollections, totpContext } from './security-db.js';
import { base32, matchingRecovery, newRecoveryCodes, totpStep } from './totp.js';

export const securityError = (message: string, statusCode = 403, code?: string) =>
  Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
export interface Proof {
  password?: string;
  code?: string;
}
interface SecurityAttempt {
  _id: string;
  lockedUntil: Date;
  expiresAt: Date;
  failures: number;
}
export function createSecurityService(db: Db, ring: KeyRing) {
  const store = securityCollections(db),
    accounts = collections(db);
  async function attempts(userId: ObjectId) {
    const attempt = await db
      .collection<SecurityAttempt>('security_attempts')
      .findOne({ _id: `reauth:${userId}` });
    if (attempt && attempt.lockedUntil > new Date())
      throw securityError('Too many verification attempts. Try again in 15 minutes.', 429);
  }
  async function failed(userId: ObjectId) {
    const now = new Date();
    await db.collection<SecurityAttempt>('security_attempts').updateOne(
      { _id: `reauth:${userId}` },
      [
        {
          $set: {
            failures: {
              $add: [
                { $cond: [{ $gt: ['$expiresAt', now] }, { $ifNull: ['$failures', 0] }, 0] },
                1,
              ],
            },
            expiresAt: new Date(now.getTime() + 900000),
          },
        },
        {
          $set: {
            lockedUntil: {
              $cond: [{ $gte: ['$failures', 5] }, new Date(now.getTime() + 900000), new Date(0)],
            },
          },
        },
      ],
      { upsert: true },
    );
  }
  async function consumeFactor(userId: ObjectId, code: string, session?: ClientSession) {
    const credential = await store.credentials.findOne({ _id: userId }, { session });
    if (!credential || code.length > 128) return false;
    if (/^\d{6}$/.test(code)) {
      const secret = ring.decrypt(credential.encrypted, totpContext(userId));
      let step: number | null;
      try {
        step = totpStep(secret, code, Date.now(), credential.lastStep);
      } finally {
        secret.fill(0);
      }
      if (step === null) return false;
      const update = await store.credentials.updateOne(
        { _id: userId, revision: credential.revision, lastStep: { $lt: step } },
        { $set: { lastStep: step } },
        { session },
      );
      return update.modifiedCount === 1;
    }
    const hash = matchingRecovery(credential.recoveryHashes, code);
    if (!hash) return false;
    const update = await store.credentials.updateOne(
      { _id: userId, revision: credential.revision, recoveryHashes: hash },
      { $pull: { recoveryHashes: hash } },
      { session },
    );
    return update.modifiedCount === 1;
  }
  async function prove(request: FastifyRequest, proof: Proof, both = false) {
    const user = request.auth!.user;
    await attempts(user._id);
    let valid = false;
    if (both)
      valid =
        !!proof.password &&
        !!proof.code &&
        (await argon2.verify(user.passwordHash, proof.password)) &&
        (await consumeFactor(user._id, proof.code));
    else if (proof.password) valid = await argon2.verify(user.passwordHash, proof.password);
    else if (proof.code && user.totpEnabled) valid = await consumeFactor(user._id, proof.code);
    if (!valid) {
      await failed(user._id);
      throw securityError(
        both
          ? 'Enter your current password and an unused authenticator or recovery code.'
          : 'Reauthenticate with your password or an unused authenticator code.',
        403,
        'REAUTH_REQUIRED',
      );
    }
  }
  async function lockSession(request: FastifyRequest, session: ClientSession, requireMfa = true) {
    const expected = request.auth!.user;
    const user = await accounts.users.findOneAndUpdate(
      {
        _id: expected._id,
        authVersion: expected.authVersion,
        state: { $nin: ['deleting', 'suspended'] },
        ...(requireMfa ? { totpEnabled: true } : {}),
      },
      { $inc: { securityRevision: 1 } },
      { session, returnDocument: 'after' },
    );
    if (!user)
      throw securityError(
        requireMfa
          ? 'Enable two-factor authentication before accessing secrets.'
          : 'Your session has expired. Sign in again.',
        401,
        requireMfa ? 'TOTP_REQUIRED' : undefined,
      );
    const locked = await accounts.sessions.updateOne(
      {
        _id: request.auth!.session._id,
        userId: user._id,
        expiresAt: { $gt: new Date() },
        $or: [
          { authVersion: user.authVersion },
          ...(user.authVersion === 0 ? [{ authVersion: { $exists: false } }] : []),
        ],
        ...(requireMfa ? { mfaVerifiedAt: { $type: 'date' } } : {}),
      },
      { $inc: { securityUse: 1 } },
      { session },
    );
    if (!locked.matchedCount) throw securityError('Your session has expired. Sign in again.', 401);
    return user;
  }
  async function withAccount<T>(
    request: FastifyRequest,
    work: (user: UserDocument, session: ClientSession) => Promise<T>,
    requireMfa = true,
  ) {
    await ensureAuditHead(db, request.auth!.user._id);
    return db.client.withSession((session) =>
      session.withTransaction(async () =>
        work(await lockSession(request, session, requireMfa), session),
      ),
    );
  }
  async function rotateSession(
    request: FastifyRequest,
    user: UserDocument,
    enabled: boolean,
    session: ClientSession,
  ) {
    const next = (await accounts.users.findOneAndUpdate(
      { _id: user._id, authVersion: user.authVersion },
      { $set: { totpEnabled: enabled }, $inc: { authVersion: 1 } },
      { session, returnDocument: 'after' },
    ))!;
    const token = randomBytes(32).toString('hex');
    await accounts.sessions.deleteMany(
      { userId: user._id, _id: { $ne: request.auth!.session._id } },
      { session },
    );
    await accounts.sessions.updateOne(
      { _id: request.auth!.session._id },
      {
        $set: {
          authVersion: next.authVersion,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          rotatedAt: new Date(),
          ...(enabled ? { mfaVerifiedAt: new Date() } : {}),
        },
        ...(!enabled ? { $unset: { mfaVerifiedAt: '' } } : {}),
      },
      { session },
    );
    return token;
  }
  const event = (request: FastifyRequest) => ({
    ownerId: request.auth!.user._id,
    actor: { kind: 'user' as const, id: request.auth!.user._id.toHexString() },
    ip: request.ip,
  });
  async function setup(request: FastifyRequest, password: string) {
    await prove(request, { password });
    return withAccount(
      request,
      async (user, session) => {
        if (user.totpEnabled)
          throw securityError('Two-factor authentication is already enabled.', 409);
        const secret = randomBytes(20),
          id = new ObjectId();
        try {
          const encoded = base32(secret),
            expiresAt = new Date(Date.now() + 600000);
          await store.enrollments.deleteOne({ userId: user._id }, { session });
          await store.enrollments.insertOne(
            {
              _id: id,
              userId: user._id,
              sessionId: request.auth!.session._id,
              authVersion: user.authVersion,
              encrypted: ring.encrypt(secret, enrollmentContext(user._id, id)),
              expiresAt,
            },
            { session },
          );
          return {
            secret: encoded,
            uri: `otpauth://totp/${encodeURIComponent(`Helious:${user.email}`)}?secret=${encoded}&issuer=Helious&algorithm=SHA1&digits=6&period=30`,
            expiresAt: expiresAt.toISOString(),
          };
        } finally {
          secret.fill(0);
        }
      },
      false,
    );
  }
  async function enable(request: FastifyRequest, code: string) {
    await attempts(request.auth!.user._id);
    try {
      return await withAccount(
        request,
        async (user, session) => {
          if (user.totpEnabled)
            throw securityError('Two-factor authentication is already enabled.', 409);
          const pending = await store.enrollments.findOne(
            {
              userId: user._id,
              sessionId: request.auth!.session._id,
              authVersion: user.authVersion,
              expiresAt: { $gt: new Date() },
            },
            { session },
          );
          if (!pending)
            throw securityError('Setup expired or changed. Start two-factor setup again.', 400);
          const secret = ring.decrypt(pending.encrypted, enrollmentContext(user._id, pending._id));
          try {
            const step = totpStep(secret, code);
            if (step === null)
              throw securityError('Enter a current six-digit authenticator code.', 403);
            const recovery = newRecoveryCodes();
            await store.credentials.insertOne(
              {
                _id: user._id,
                encrypted: ring.encrypt(secret, totpContext(user._id)),
                lastStep: step,
                recoveryHashes: recovery.hashes,
                revision: 1,
              },
              { session },
            );
            await store.enrollments.deleteOne({ _id: pending._id }, { session });
            const sessionToken = await rotateSession(request, user, true, session);
            await appendAudit(
              db,
              { ...event(request), action: 'mfa.enable', outcome: 'success' },
              session,
            );
            return { sessionToken, recoveryCodes: recovery.codes };
          } finally {
            secret.fill(0);
          }
        },
        false,
      );
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error && error.statusCode === 403)
        await failed(request.auth!.user._id);
      throw error;
    }
  }
  async function disable(request: FastifyRequest, proof: Proof) {
    await prove(request, proof, true);
    return withAccount(request, async (user, session) => {
      if (
        await store.secrets.countDocuments(
          { ownerId: user._id, state: 'active' },
          { session, limit: 1 },
        )
      )
        throw securityError(
          'Delete stored secrets before disabling two-factor authentication.',
          409,
        );
      await store.credentials.deleteOne({ _id: user._id }, { session });
      await store.enrollments.deleteMany({ userId: user._id }, { session });
      const sessionToken = await rotateSession(request, user, false, session);
      await appendAudit(
        db,
        { ...event(request), action: 'mfa.disable', outcome: 'success' },
        session,
      );
      return { sessionToken };
    });
  }
  async function recovery(request: FastifyRequest, proof: Proof) {
    await prove(request, proof, true);
    return withAccount(request, async (user, session) => {
      const recovery = newRecoveryCodes();
      await store.credentials.updateOne(
        { _id: user._id },
        { $set: { recoveryHashes: recovery.hashes }, $inc: { revision: 1 } },
        { session },
      );
      await appendAudit(
        db,
        { ...event(request), action: 'mfa.recovery', outcome: 'success' },
        session,
      );
      return { recoveryCodes: recovery.codes };
    });
  }
  return { prove, consumeFactor, lockSession, withAccount, setup, enable, disable, recovery };
}
export type SecurityService = ReturnType<typeof createSecurityService>;
