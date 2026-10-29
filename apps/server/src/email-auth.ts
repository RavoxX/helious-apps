import argon2 from 'argon2';
import { MongoServerError, type Db } from 'mongodb';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Store, UserDocument } from './db.js';
import { emailMessage, type EmailService, type EmailKind } from './email.js';
import { EmailTokens, emailTokenHash } from './email-tokens.js';
import { EmailNotifications } from './email-notifications.js';

export const NEUTRAL_EMAIL_MESSAGE = 'If an account exists, we sent you an email';
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const invalidLink = 'This link is expired, already used, or invalid. Request a new link.';
const failure = 'We could not send your email. Please try again later.';
type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export async function registerEmailAuth(
  app: FastifyInstance,
  store: Store,
  config: Config,
  mail: EmailService,
  db: Db,
  authenticate: Guard,
  hashPassword: (password: string) => Promise<string>,
) {
  const tokens = new EmailTokens(db);
  const notices = new EmailNotifications(db, mail, () =>
    app.log.error('Security notification email delivery failed'),
  );
  await notices.initialize();
  const noticeTasks = new Set<Promise<unknown>>();
  const tick = () => {
    const task = notices.flush().catch(() => app.log.error('Security notification queue failed'));
    noticeTasks.add(task);
    void task.finally(() => noticeTasks.delete(task));
  };
  const timer = setInterval(tick, 30_000);
  timer.unref();
  app.addHook('onReady', async () => {
    await notices.flush();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await Promise.allSettled([...noticeTasks]);
  });
  const pending = new Set<Promise<unknown>>();
  app.addHook('onClose', async () => {
    await Promise.allSettled([...pending]);
  });
  const limit = { rateLimit: { max: 10, timeWindow: '15 minutes' } };
  const schema = (summary: string, body: Record<string, unknown>) => ({
    tags: ['Email auth'],
    summary,
    body,
  });
  const emailBody = {
    type: 'object',
    required: ['email'],
    properties: { email: { type: 'string', format: 'email', maxLength: 254 } },
    additionalProperties: false,
  };
  const tokenBody = {
    type: 'object',
    required: ['token'],
    properties: { token: { type: 'string', maxLength: 128 } },
    additionalProperties: false,
  };
  async function deliver(to: string, kind: EmailKind, url: string) {
    try {
      if (kind === 'password-changed' || kind === 'email-changed')
        return await notices.send(to, kind, url);
      await mail.send(await emailMessage(to, kind, url));
      return true;
    } catch {
      app.log.error({ kind }, 'Account email delivery failed');
      return false;
    }
  }
  async function sendVerification(user: UserDocument) {
    if (!(await tokens.allowEmail(user.email))) return false;
    const issued = await tokens.issue(user._id, 'verify-email');
    return deliver(
      user.email,
      'verification',
      `${config.PUBLIC_URL}/verify-email?token=${issued.token}`,
    );
  }
  app.post(
    '/api/auth/token-status',
    { config: limit, schema: schema('Check a reset link without consuming it', tokenBody) },
    async (request, reply) => {
      const token = (request.body as { token: string }).token;
      if (!(await tokens.inspect(token, ['reset-password'])))
        return reply.code(400).send({ error: invalidLink });
      return { valid: true };
    },
  );
  app.post(
    '/api/auth/resend-verification',
    { config: limit, schema: schema('Request a fresh verification email', emailBody) },
    async (request, reply) => {
      const address = email.parse((request.body as { email: string }).email);
      const allowed = await tokens.allowEmail(address);
      const user = await store.users.findOne({ email: address, emailVerified: false });
      if (user && allowed) {
        const issued = await tokens.issue(user._id, 'verify-email');
        if (
          !(await deliver(
            address,
            'verification',
            `${config.PUBLIC_URL}/verify-email?token=${issued.token}`,
          ))
        )
          return reply.code(503).send({ error: failure });
      }
      return reply.code(202).send({ message: NEUTRAL_EMAIL_MESSAGE });
    },
  );
  app.post(
    '/api/auth/forgot-password',
    {
      config: limit,
      schema: schema('Request a password reset without disclosing account existence', emailBody),
    },
    async (request, reply) => {
      const address = email.parse((request.body as { email: string }).email);
      const allowed = await tokens.allowEmail(address);
      if (allowed) {
        // Delivery runs after the neutral response so provider latency cannot enumerate accounts.
        const work = new Promise<void>((resolve) => setImmediate(resolve))
          .then(async () => {
            const user = await store.users.findOne({ email: address });
            if (!user) return;
            const issued = await tokens.issue(user._id, 'reset-password');
            await deliver(
              address,
              'password-reset',
              `${config.PUBLIC_URL}/reset-password?token=${issued.token}`,
            );
          })
          .catch(() => {
            app.log.error('Password reset email could not be prepared');
          });
        pending.add(work);
        void work.finally(() => pending.delete(work));
      }
      // Identical on unknown accounts, throttling and delivery failure. UI always explains retrying delayed mail.
      return reply.code(202).send({ message: NEUTRAL_EMAIL_MESSAGE });
    },
  );
  app.post(
    '/api/auth/verify-email',
    { config: limit, schema: schema('Consume a single-use email verification link', tokenBody) },
    async (request, reply) => {
      const body = z.object({ token: z.string().max(128) }).parse(request.body);
      const token = await tokens.consume(body.token, ['verify-email', 'change-email']);
      if (!token) return reply.code(400).send({ error: invalidLink });
      const user = await store.users.findOne({ _id: token.userId });
      if (!user) return reply.code(400).send({ error: invalidLink });
      if (token.type === 'verify-email') {
        await store.users.updateOne(
          { _id: user._id, emailVerified: false },
          { $set: { emailVerified: true, verifiedAt: new Date() } },
        );
      } else {
        if (!token.targetEmail || token.targetEmail !== user.pendingEmail)
          return reply.code(400).send({ error: invalidLink });
        try {
          const result = await store.users.updateOne(
            { _id: user._id, pendingEmail: token.targetEmail },
            {
              $set: { email: token.targetEmail, emailVerified: true, verifiedAt: new Date() },
              $unset: { pendingEmail: '' },
              $inc: { authVersion: 1 },
            },
          );
          if (!result.modifiedCount) return reply.code(400).send({ error: invalidLink });
        } catch (error) {
          if (error instanceof MongoServerError && error.code === 11000)
            return reply.code(409).send({
              error:
                'That email address is unavailable. Request another address from your account.',
            });
          throw error;
        }
        await store.sessions.deleteMany({ userId: user._id });
        await db
          .collection('email_tokens')
          .updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: new Date() } });
        await Promise.all([
          deliver(user.email, 'email-changed', `${config.PUBLIC_URL}/app/?mode=login`),
          deliver(token.targetEmail, 'email-changed', `${config.PUBLIC_URL}/app/?mode=login`),
        ]);
      }
      return { message: 'Email verified. You can now sign in.' };
    },
  );
  app.post(
    '/api/auth/reset-password',
    {
      config: limit,
      schema: schema('Reset a password and invalidate all browser sessions', {
        ...tokenBody,
        required: ['token', 'password'],
        properties: {
          ...tokenBody.properties,
          password: { type: 'string', minLength: 12, maxLength: 128 },
        },
      }),
    },
    async (request, reply) => {
      const body = z
        .object({ token: z.string().max(128), password: z.string().min(12).max(128) })
        .parse(request.body);
      if (
        new Set(body.password.toLowerCase()).size < 5 ||
        /^(?:password|123456|qwerty)/i.test(body.password)
      )
        return reply.code(400).send({
          error:
            'Choose a stronger password: use several distinct words or a longer varied phrase.',
        });
      const passwordHash = await hashPassword(body.password);
      const token = await tokens.consume(body.token, ['reset-password']);
      if (!token) return reply.code(400).send({ error: invalidLink });
      const user = await store.users.findOneAndUpdate(
        { _id: token.userId },
        { $set: { passwordHash }, $unset: { pendingEmail: '' }, $inc: { authVersion: 1 } },
        { returnDocument: 'after' },
      );
      if (!user) return reply.code(400).send({ error: invalidLink });
      await store.sessions.deleteMany({ userId: user._id });
      await db
        .collection('email_tokens')
        .updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: new Date() } });
      await store.loginAttempts.deleteOne({ _id: emailTokenHash(user.email) });
      const sent = await deliver(
        user.email,
        'password-changed',
        `${config.PUBLIC_URL}/app/?mode=login`,
      );
      return {
        message:
          'Password changed. All browser sessions have been signed out. Review your existing agent/MCP tokens.',
        ...(!sent
          ? { warning: 'Your password changed, but the notification email could not be sent.' }
          : {}),
      };
    },
  );
  app.post(
    '/api/account/email',
    {
      preHandler: authenticate,
      config: limit,
      schema: {
        ...schema('Request an email change; the old address stays active until verification', {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: emailBody.properties.email,
            password: { type: 'string', maxLength: 128 },
          },
          additionalProperties: false,
        }),
        security: [{ session: [] }],
      },
    },
    async (request, reply) => {
      const body = z.object({ email, password: z.string().max(128) }).parse(request.body);
      const user = request.auth!.user;
      if (!(await argon2.verify(user.passwordHash, body.password)))
        return reply.code(401).send({ error: 'Your current password is incorrect.' });
      if (body.email === user.email || (await store.users.findOne({ email: body.email })))
        return reply.code(409).send({ error: 'Choose a different available email address.' });
      if (!(await tokens.allowEmail(body.email)))
        return reply.code(429).send({ error: 'Too many emails. Try again in 15 minutes.' });
      const updated = await store.users.updateOne(
        { _id: user._id, authVersion: user.authVersion, emailVerified: true },
        { $set: { pendingEmail: body.email } },
      );
      if (!updated.matchedCount)
        return reply.code(401).send({ error: 'Your session has expired. Sign in again.' });
      const issued = await tokens.issue(user._id, 'change-email', body.email);
      if (
        !(await deliver(
          body.email,
          'verification',
          `${config.PUBLIC_URL}/verify-email?token=${issued.token}`,
        ))
      )
        return reply.code(503).send({ error: failure });
      return {
        message:
          'Check your new address for a verification link. Your current email stays active until you verify.',
        pendingEmail: body.email,
      };
    },
  );
  return { sendVerification };
}
