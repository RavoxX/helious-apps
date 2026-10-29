import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { MongoServerError, ObjectId, type Db } from 'mongodb';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { SessionDocument, Store, UserDocument } from './db.js';
import type { EmailService } from './email.js';
import { registerEmailAuth } from './email-auth.js';
import type { SecurityService } from './security-service.js';

const SESSION_COOKIE = 'helious_session';
const CSRF_COOKIE = 'helious_csrf';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ROTATE_MS = 15 * 60 * 1000;
const password = z.string().min(12).max(128);
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password,
  code: z.string().max(128).optional(),
});
const registration = credentials.extend({ name: z.string().trim().min(1).max(80) });
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const hashPassword = (value: string) =>
  argon2.hash(value, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
const publicUser = (user: UserDocument) => ({
  id: user._id.toHexString(),
  email: user.email,
  name: user.name,
  role: user.role,
  emailVerified: user.emailVerified,
  totpEnabled: !!user.totpEnabled,
  ...(user.pendingEmail ? { pendingEmail: user.pendingEmail } : {}),
});

declare module 'fastify' {
  interface FastifyRequest {
    auth: { user: UserDocument; session: SessionDocument } | null;
  }
}

export async function registerAuth(
  app: FastifyInstance,
  store: Store,
  config: Config,
  emailService: EmailService,
  db: Db,
  security: SecurityService,
) {
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax' as const,
  };
  // A real Argon2 verification even for missing accounts reduces email timing enumeration.
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.config.credentialTransport) return;
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (request.headers.origin !== config.PUBLIC_URL)
      return reply.code(403).send({ error: 'Request origin is not allowed' });
    const csrf = request.cookies[CSRF_COOKIE];
    const signed = csrf ? request.unsignCookie(csrf) : null;
    const header = request.headers['x-csrf-token'];
    if (
      !signed?.valid ||
      typeof signed.value !== 'string' ||
      typeof header !== 'string' ||
      !/^[a-f0-9]{64}$/.test(header) ||
      header.length !== signed.value.length ||
      !timingSafeEqual(Buffer.from(header), Buffer.from(signed.value))
    ) {
      return reply.code(403).send({ error: 'Invalid CSRF token. Refresh and try again.' });
    }
    const attachmentUpload =
      request.method === 'POST' &&
      /^\/api\/vaults\/[a-f0-9]{24}\/attachments(?:\?|$)/.test(request.url) &&
      request.headers['content-type']?.startsWith('multipart/form-data;');
    if (!attachmentUpload && request.headers['content-type']?.split(';')[0] !== 'application/json')
      return reply.code(415).send({ error: 'JSON is required' });
  });

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      return reply.code(401).send({ error: 'Sign in to continue' });
    const session = await store.sessions.findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    });
    const user = session ? await store.users.findOne({ _id: session.userId }) : null;
    if (!session || !user)
      return reply.code(401).send({ error: 'Your session has expired. Sign in again.' });
    if (!user.emailVerified)
      return reply.code(403).send({ error: 'Please verify your email', code: 'EMAIL_UNVERIFIED' });
    if ((session.authVersion ?? 0) !== user.authVersion)
      return reply.code(401).send({ error: 'Your session has expired. Sign in again.' });
    if (user.totpEnabled && !(session.mfaVerifiedAt instanceof Date))
      return reply
        .code(401)
        .send({ error: 'Sign in with two-factor authentication.', code: 'TOTP_REQUIRED' });
    request.auth = { user, session };
    if (Date.now() - session.rotatedAt.getTime() > ROTATE_MS) {
      const next = randomBytes(32).toString('hex');
      const rotated = await store.sessions.updateOne(
        { _id: session._id, tokenHash: session.tokenHash },
        { $set: { tokenHash: hashToken(next), rotatedAt: new Date() } },
      );
      if (rotated.modifiedCount)
        reply.setCookie(SESSION_COOKIE, next, { ...cookieOptions, expires: session.expiresAt });
    }
  };
  const createSession = async (
    user: UserDocument,
    request: FastifyRequest,
    reply: FastifyReply,
    mfa = false,
  ) => {
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    await store.sessions.insertOne({
      _id: new ObjectId(),
      userId: user._id,
      tokenHash: hashToken(token),
      createdAt: now,
      rotatedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_MS),
      userAgent: (request.headers['user-agent'] ?? 'Unknown browser').slice(0, 256),
      authVersion: user.authVersion,
      ...(mfa ? { mfaVerifiedAt: now } : {}),
    });
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS / 1000 });
  };
  async function recordLoginFailure(emailKey: string) {
    const now = new Date();
    await store.loginAttempts.updateOne(
      { _id: emailKey },
      [
        {
          $set: {
            failures: {
              $add: [
                { $cond: [{ $gt: ['$expiresAt', now] }, { $ifNull: ['$failures', 0] }, 0] },
                1,
              ],
            },
            expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
          },
        },
        {
          $set: {
            lockedUntil: {
              $cond: [
                { $gte: ['$failures', 5] },
                new Date(now.getTime() + 15 * 60 * 1000),
                new Date(0),
              ],
            },
          },
        },
      ],
      { upsert: true },
    );
  }
  const authLimit = { rateLimit: { max: 10, timeWindow: '15 minutes' } };
  const { sendVerification } = await registerEmailAuth(
    app,
    store,
    config,
    emailService,
    db,
    authenticate,
    hashPassword,
  );

  app.get(
    '/api/auth/csrf',
    { schema: { tags: ['Auth'], summary: 'Get a signed double-submit CSRF token' } },
    async (_request, reply) => {
      const token = randomBytes(32).toString('hex');
      reply.setCookie(CSRF_COOKIE, token, { ...cookieOptions, signed: true, maxAge: 60 * 60 });
      return { csrfToken: token };
    },
  );
  app.get('/api/auth/config', async () => {
    const settings = await store.settings.findOne({ _id: 'registration' });
    return { registrationOpen: settings?.registrationOpen ?? config.REGISTRATION_OPEN };
  });

  app.post(
    '/api/auth/register',
    {
      config: authLimit,
      schema: {
        tags: ['Auth'],
        summary: 'Register an unverified account and send a verification email',
        body: {
          type: 'object',
          required: ['email', 'password', 'name'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 12, maxLength: 128 },
            name: { type: 'string', minLength: 1, maxLength: 80 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const settings = await store.settings.findOne({ _id: 'registration' });
      if (!(settings?.registrationOpen ?? config.REGISTRATION_OPEN))
        return reply
          .code(403)
          .send({ error: 'Registration is closed. Contact your administrator.' });
      const parsed = registration.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'Enter a valid email, name, and password of 12–128 characters.' });
      const { email, name, password: value } = parsed.data;
      const user: UserDocument = {
        _id: new ObjectId(),
        email,
        name,
        passwordHash: await hashPassword(value),
        role: 'user',
        createdAt: new Date(),
        emailVerified: false,
        authVersion: 0,
      };
      try {
        await store.users.insertOne(user);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000)
          return reply.code(409).send({ error: 'An account with this email already exists.' });
        throw error;
      }
      // Atomic singleton ownership: concurrent registrations cannot both become the first admin.
      const bootstrap = await store.settings.findOneAndUpdate(
        { _id: 'bootstrap' },
        { $setOnInsert: { adminId: user._id } },
        { upsert: true, returnDocument: 'after' },
      );
      if (bootstrap?.adminId?.equals(user._id)) {
        await store.users.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
        user.role = 'admin';
      }
      if (!(await sendVerification(user)))
        return reply.code(503).send({
          code: 'EMAIL_DELIVERY_FAILED',
          error:
            'Your account was created, but we could not send the verification email. Use Resend verification email to try again.',
        });
      return reply
        .code(201)
        .send({ verificationRequired: true, message: 'Please verify your email' });
    },
  );

  app.post(
    '/api/auth/login',
    {
      config: authLimit,
      schema: {
        tags: ['Auth'],
        summary: 'Sign in with email and password',
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', maxLength: 128 },
            code: { type: 'string', maxLength: 128 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const parsed = credentials.safeParse(request.body);
      if (!parsed.success)
        return reply.code(401).send({ error: 'Email or password is incorrect.' });
      const { email, password: value } = parsed.data;
      const emailKey = hashToken(email);
      const attempt = await store.loginAttempts.findOne({ _id: emailKey });
      if (attempt && attempt.lockedUntil > new Date())
        return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
      const user = await store.users.findOne({ email });
      const valid = await argon2.verify(user?.passwordHash ?? dummyHash, value);
      if (!user || !valid) {
        await recordLoginFailure(emailKey);
        return reply.code(401).send({ error: 'Email or password is incorrect.' });
      }
      if (!user.emailVerified)
        return reply
          .code(403)
          .send({ error: 'Please verify your email', code: 'EMAIL_UNVERIFIED' });
      if (user.totpEnabled) {
        if (!parsed.data.code)
          return reply
            .code(401)
            .send({ error: 'Enter an authenticator or recovery code.', code: 'TOTP_REQUIRED' });
        if (!(await security.consumeFactor(user._id, parsed.data.code))) {
          await recordLoginFailure(emailKey);
          return reply.code(401).send({
            error: 'The authenticator or recovery code is invalid or already used.',
            code: 'TOTP_INVALID',
          });
        }
      }
      await store.loginAttempts.deleteOne({ _id: emailKey });
      await createSession(user, request, reply, !!user.totpEnabled);
      return { user: publicUser(user) };
    },
  );

  app.get(
    '/api/auth/me',
    {
      preHandler: authenticate,
      schema: { tags: ['Auth'], summary: 'Get the signed-in account; rotate old session IDs' },
    },
    async (request) => ({ user: publicUser(request.auth!.user) }),
  );
  app.post(
    '/api/auth/logout',
    { preHandler: authenticate, schema: { tags: ['Auth'], summary: 'Revoke the current session' } },
    async (request, reply) => {
      await store.sessions.deleteOne({ _id: request.auth!.session._id });
      reply.clearCookie(SESSION_COOKIE, cookieOptions);
      return { ok: true };
    },
  );
  app.get(
    '/api/auth/sessions',
    { preHandler: authenticate, schema: { tags: ['Auth'], summary: 'List your active sessions' } },
    async (request) => {
      const { user, session } = request.auth!;
      const sessions = await store.sessions
        .find({ userId: user._id, expiresAt: { $gt: new Date() } })
        .sort({ createdAt: -1 })
        .toArray();
      return {
        sessions: sessions.map((item) => ({
          id: item._id.toHexString(),
          current: item._id.equals(session._id),
          createdAt: item.createdAt.toISOString(),
          expiresAt: item.expiresAt.toISOString(),
          userAgent: item.userAgent,
        })),
      };
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/auth/sessions/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Auth'],
        summary: 'Revoke one of your sessions',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^[a-f0-9]{24}$' } },
        },
      },
    },
    async (request, reply) => {
      const id = new ObjectId(request.params.id);
      const result = await store.sessions.deleteOne({ _id: id, userId: request.auth!.user._id });
      if (!result.deletedCount) return reply.code(404).send({ error: 'Session not found' });
      if (id.equals(request.auth!.session._id)) reply.clearCookie(SESSION_COOKIE, cookieOptions);
      return { ok: true };
    },
  );
  app.put(
    '/api/admin/registration',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Admin'],
        summary: 'Enable or disable registration (administrator only)',
        body: {
          type: 'object',
          required: ['open'],
          properties: { open: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (request.auth!.user.role !== 'admin')
        return reply.code(403).send({ error: 'Administrator access required' });
      const parsed = z.object({ open: z.boolean() }).parse(request.body);
      await store.settings.updateOne(
        { _id: 'registration' },
        { $set: { registrationOpen: parsed.open } },
        { upsert: true },
      );
      return { registrationOpen: parsed.open };
    },
  );
  const setSessionCookie = (reply: FastifyReply, token: string, expires: Date) =>
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires });
  return { authenticate, setSessionCookie };
}
