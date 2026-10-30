import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { ObjectId, type Db, type Document } from 'mongodb';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZipFile } from 'yazl';
import { z } from 'zod';
import { normalizeVaultPath } from '@helious/core';
import { collections } from './db.js';
import { vaultCollections } from './vault-db.js';
import { securityError, type SecurityService } from './security-service.js';
import type { Config } from './config.js';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
const proof = z.object({
  password: z.string().min(1).max(128),
  code: z.string().max(128).optional(),
});
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
interface ExportGrant {
  _id: string;
  userId: ObjectId;
  sessionId: ObjectId;
  authVersion: number;
  expiresAt: Date;
}
interface DeletionJob {
  _id: ObjectId;
  state: 'pending' | 'running' | 'complete';
  requestedAt: Date;
  notBefore: Date;
  leaseUntil?: Date;
  lease?: string;
  attempts: number;
  completedAt?: Date;
  expiresAt?: Date;
}

/** Idempotent account erasure. The account and vaults were frozen in the request transaction. */
export async function processAccountDeletions(db: Db, now = new Date()) {
  const jobs = db.collection<DeletionJob>('account_deletions');
  for (let i = 0; i < 5; i++) {
    const lease = randomUUID();
    const job = await jobs.findOneAndUpdate(
      {
        state: { $in: ['pending', 'running'] },
        notBefore: { $lte: now },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
      },
      {
        $set: { state: 'running', lease, leaseUntil: new Date(now.getTime() + 300_000) },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!job) break;
    const ownerId = job._id;
    try {
      const user = await collections(db).users.findOne({ _id: ownerId });
      if (user && user.state !== 'deleting') throw new Error('Deletion account is not frozen');
      const store = vaultCollections(db);
      // Remove both ready metadata and interrupted GridFS uploads. Each delete is retryable.
      const fileIds = new Set<string>();
      for await (const file of store.attachments.find({ ownerId }, { projection: { _id: 1 } }))
        fileIds.add(file._id.toHexString());
      for await (const file of db
        .collection('attachments.files')
        .find({ 'metadata.ownerId': ownerId }, { projection: { _id: 1 } }))
        fileIds.add(file._id.toHexString());
      for (const id of fileIds) {
        const active = await jobs.updateOne(
          { _id: ownerId, lease },
          { $set: { leaseUntil: new Date(Date.now() + 300_000) } },
        );
        if (!active.matchedCount) throw new Error('Deletion lease changed');
        try {
          await store.bucket.delete(new ObjectId(id));
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('File not found')) throw error;
          await db.collection('attachments.chunks').deleteMany({ files_id: new ObjectId(id) });
        }
        await store.attachments.deleteOne({ _id: new ObjectId(id), ownerId });
      }
      for (const name of [
        'notes',
        'note_versions',
        'note_changes',
        'spaces',
        'secrets',
        'secret_approvals',
        'secret_audit',
        'agent_tokens',
        'agent_activity',
        'oauth_requests',
        'oauth_codes',
        'oauth_refresh',
        'vaults',
      ])
        await db.collection(name).deleteMany({ ownerId });
      for (const name of ['sessions', 'email_tokens', 'totp_enrollments', 'account_exports'])
        await db.collection(name).deleteMany({ userId: ownerId });
      await db.collection('security_events').deleteMany({ userId: ownerId });
      for (const name of ['security_credentials', 'secret_audit_heads'])
        await db.collection(name).deleteOne({ _id: ownerId });
      await db
        .collection<{ _id: string }>('security_attempts')
        .deleteOne({ _id: `reauth:${ownerId}` });
      if (user) {
        const addresses = [user.email, ...(user.pendingEmail ? [user.pendingEmail] : [])];
        await db
          .collection('email_notifications')
          .deleteMany({ $or: [{ userId: ownerId }, { to: { $in: addresses } }] });
        await collections(db).loginAttempts.deleteMany({ _id: { $in: addresses.map(digest) } });
      }
      await collections(db).users.deleteOne({ _id: ownerId, state: 'deleting' });
      await jobs.updateOne(
        { _id: ownerId, lease },
        {
          $set: {
            state: 'complete',
            completedAt: new Date(),
            expiresAt: new Date(Date.now() + 86400_000),
          },
          $unset: { leaseUntil: '', lease: '' },
        },
      );
    } catch {
      await jobs.updateOne(
        { _id: ownerId, lease },
        {
          $set: { state: 'pending', notBefore: new Date(Date.now() + 60_000) },
          $unset: { leaseUntil: '', lease: '' },
        },
      );
      // No record contents, email addresses or credentials in the retry error.
      throw new Error('Account deletion could not finish; it remains queued for retry.');
    }
  }
}

const recordTables: [string, Document][] = [
  ['vaults', { name: 1, state: 1, createdAt: 1, updatedAt: 1 }],
  [
    'spaces',
    {
      vaultId: 1,
      name: 1,
      key: 1,
      kind: 1,
      agentAccess: 1,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  [
    'attachmentFiles',
    {
      vaultId: 1,
      spaceId: 1,
      path: 1,
      mimeType: 1,
      size: 1,
      state: 1,
      createdAt: 1,
      revision: 1,
      contentHash: 1,
    },
  ],
  [
    'note_versions',
    {
      vaultId: 1,
      noteId: 1,
      spaceId: 1,
      revision: 1,
      path: 1,
      markdown: 1,
      action: 1,
      actor: 1,
      recordedAt: 1,
    },
  ],
  ['note_changes', { vaultId: 1, noteId: 1, spaceId: 1, action: 1, at: 1 }],
  [
    'agent_tokens',
    {
      name: 1,
      kind: 1,
      vaultIds: 1,
      spaceIds: 1,
      scopes: 1,
      createdAt: 1,
      expiresAt: 1,
      revokedAt: 1,
      lastUsedAt: 1,
      clientId: 1,
    },
  ],
  [
    'agent_activity',
    {
      vaultId: 1,
      spaceId: 1,
      noteId: 1,
      tokenId: 1,
      agent: 1,
      agentId: 1,
      tool: 1,
      action: 1,
      at: 1,
      outcome: 1,
    },
  ],
  [
    'secrets',
    {
      vaultId: 1,
      spaceId: 1,
      name: 1,
      kind: 1,
      agentAccess: 1,
      requireApproval: 1,
      state: 1,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  [
    'secret_audit',
    { seq: 1, actor: 1, action: 1, outcome: 1, ip: 1, vaultId: 1, spaceId: 1, secretId: 1, at: 1 },
  ],
];
async function exportArchive(db: Db, request: FastifyRequest, limit: number) {
  const { user, session } = request.auth!;
  const store = vaultCollections(db),
    zip = new ZipFile();
  const output = zip.outputStream as Readable; // yazl exposes a Node PassThrough; its typings use the older NodeJS interface.
  let total = 0;
  const sources = new Set<Readable>();
  const alive = async () => {
    if (output.destroyed) throw new Error('Download closed');
    const current = await collections(db).users.findOne({
      _id: user._id,
      authVersion: user.authVersion,
      state: { $nin: ['deleting', 'suspended'] },
    });
    if (!current) throw new Error('Account changed during export');
    if (
      !(await collections(db).sessions.findOne({
        _id: session._id,
        userId: user._id,
        expiresAt: { $gt: new Date() },
      }))
    )
      throw new Error('Session ended during export');
  };
  const bounded = (source: Readable) => {
    sources.add(source);
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        callback(
          total > limit ? new Error('Export exceeded its configured size limit') : null,
          chunk,
        );
      },
    });
    source.on('error', (error) => meter.destroy(error));
    meter.on('close', () => {
      source.destroy();
      sources.delete(source);
    });
    return source.pipe(meter);
  };
  const add = (name: string, factory: () => Promise<Readable>) =>
    zip.addReadStreamLazy(name, (callback) => {
      void alive()
        .then(factory)
        .then((source) => callback(null, bounded(source)))
        .catch((error: unknown) =>
          callback(error instanceof Error ? error : new Error('Export failed'), Readable.from([])),
        );
    });
  zip.on('error', () => output.destroy(new Error('Export interrupted; request a fresh download.')));
  output.on('close', () => {
    for (const source of sources) source.destroy();
  });
  const noteCount = await store.notes.countDocuments({ ownerId: user._id, deleted: { $ne: true } });
  const fileCount = await store.attachments.countDocuments({ ownerId: user._id, state: 'ready' });
  if (noteCount + fileCount > 50_000)
    throw securityError(
      'This export needs operator assistance because it exceeds 50,000 files.',
      413,
    );
  add('README.txt', async () =>
    Readable.from([
      'Helious account export\n\nCurrent Markdown and attachments are in vaults/<vault-id>/files at their original paths. Records are newline-delimited JSON. Deleted note history is in note_versions.ndjson. Secret values, password hashes, authenticator material and token credentials are excluded. This portable export is not a consistent database backup; content can change during download. Protect the ZIP as private data.\n',
    ]),
  );
  add('account.json', async () =>
    Readable.from([
      JSON.stringify(
        {
          schema: 1,
          exportedAt: new Date(),
          user: {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            createdAt: user.createdAt,
            emailVerified: user.emailVerified,
            totpEnabled: !!user.totpEnabled,
            policyAcceptance: user.policyAcceptance,
          },
        },
        null,
        2,
      ),
    ]),
  );
  for (const [name, projection] of recordTables)
    add(`records/${name}.ndjson`, async () =>
      Readable.from(
        (async function* () {
          for await (const row of db.collection(name).find({ ownerId: user._id }, { projection }))
            yield JSON.stringify(row) + '\n';
        })(),
      ),
    );
  add('records/sessions.ndjson', async () =>
    Readable.from(
      (async function* () {
        for await (const row of collections(db).sessions.find(
          { userId: user._id },
          { projection: { createdAt: 1, rotatedAt: 1, expiresAt: 1, userAgent: 1 } },
        ))
          yield JSON.stringify(row) + '\n';
      })(),
    ),
  );
  add('records/security_events.ndjson', async () =>
    Readable.from(
      (async function* () {
        for await (const row of db
          .collection('security_events')
          .find(
            { userId: user._id, expiresAt: { $gt: new Date() } },
            { projection: { at: 1, ip: 1, route: 1, method: 1, status: 1 } },
          ))
          yield JSON.stringify(row) + '\n';
      })(),
    ),
  );
  for await (const note of store.notes.find(
    { ownerId: user._id, deleted: { $ne: true } },
    { projection: { _id: 1, vaultId: 1, path: 1 } },
  )) {
    const id = note._id;
    add(`vaults/${note.vaultId}/files/${normalizeVaultPath(note.path)}`, async () => {
      const current = await store.notes.findOne({
        _id: id,
        ownerId: user._id,
        deleted: { $ne: true },
      });
      if (!current) throw new Error('Note changed during export');
      return Readable.from([current.markdown]);
    });
  }
  for await (const file of store.attachments.find(
    { ownerId: user._id, state: 'ready' },
    { projection: { _id: 1, vaultId: 1, path: 1 } },
  )) {
    add(`vaults/${file.vaultId}/files/${normalizeVaultPath(file.path)}`, async () => {
      if (!(await store.attachments.findOne({ _id: file._id, ownerId: user._id, state: 'ready' })))
        throw new Error('Attachment changed during export');
      return store.bucket.openDownloadStream(file._id);
    });
  }
  // Every input is lazy. Returning the output lets HTTP backpressure bound memory.
  zip.end();
  return output;
}

export async function registerAccountRights(
  app: FastifyInstance,
  db: Db,
  config: Config,
  authenticate: Guard,
  security: SecurityService,
) {
  const grants = db.collection<ExportGrant>('account_exports'),
    jobs = db.collection<DeletionJob>('account_deletions');
  await Promise.all([
    grants.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    jobs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    jobs.createIndex({ state: 1, notBefore: 1 }),
  ]);
  await collections(db).settings.updateOne(
    { _id: 'admin-guard' },
    { $setOnInsert: { revision: 0 } },
    { upsert: true },
  );
  const options = (summary: string, body: z.ZodType, max = 5) => ({
    // Validate strict input before Fastify/Ajv's default removal of extra fields.
    preValidation: async (request: FastifyRequest, reply: FastifyReply) => {
      if (!body.safeParse(request.body).success)
        return reply.code(400).send({ error: 'Check the submitted fields and try again.' });
    },
    preHandler: authenticate,
    config: { rateLimit: { max, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Account'],
      summary,
      body: z.toJSONSchema(body, { target: 'draft-7', io: 'input' }),
    },
  });
  app.patch(
    '/api/account/profile',
    options(
      'Correct your profile name',
      z.object({ name: z.string().trim().min(1).max(80) }).strict(),
    ),
    async (request) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
      await security.withAccount(
        request,
        async (user, session) => {
          await collections(db).users.updateOne({ _id: user._id }, { $set: { name } }, { session });
        },
        false,
      );
      return { ok: true, name };
    },
  );
  app.post(
    '/api/account/export',
    options('Authorize a single-use portable account export', proof.strict(), 3),
    async (request) => {
      const body = proof.parse(request.body);
      await security.prove(request, body, !!request.auth!.user.totpEnabled);
      const token = randomBytes(32).toString('base64url');
      await security.withAccount(
        request,
        async (user, session) => {
          await grants.deleteMany({ userId: user._id }, { session });
          await grants.insertOne(
            {
              _id: digest(token),
              userId: user._id,
              sessionId: request.auth!.session._id,
              authVersion: user.authVersion,
              expiresAt: new Date(Date.now() + 300_000),
            },
            { session },
          );
        },
        false,
      );
      return { url: `/api/account/export/${token}`, expiresInSeconds: 300 };
    },
  );
  app.get<{ Params: { token: string } }>(
    '/api/account/export/:token',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Account'],
        summary: 'Download your single-use export',
        params: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } },
        },
      },
    },
    async (request, reply) => {
      const { user, session } = request.auth!;
      const grant = await grants.findOneAndDelete({
        _id: digest(request.params.token),
        userId: user._id,
        sessionId: session._id,
        authVersion: user.authVersion,
        expiresAt: { $gt: new Date() },
      });
      if (!grant)
        return reply
          .code(404)
          .send({ error: 'This download expired or was already used. Request a new export.' });
      reply
        .header('Referrer-Policy', 'no-referrer')
        .header(
          'Content-Disposition',
          `attachment; filename="helious-export-${new Date().toISOString().slice(0, 10)}.zip"`,
        )
        .type('application/zip');
      return reply.send(await exportArchive(db, request, config.ACCOUNT_EXPORT_MAX_BYTES));
    },
  );
  const deletion = proof.extend({ confirmation: z.string().max(280) }).strict();
  app.post(
    '/api/account/delete',
    options('Reauthenticate, revoke access and queue permanent account erasure', deletion, 3),
    async (request, reply) => {
      const body = deletion.parse(request.body),
        expected = request.auth!.user;
      if (body.confirmation !== `DELETE ${expected.email}`)
        throw securityError('Type DELETE followed by your exact account email address.', 400);
      await security.prove(request, body, !!expected.totpEnabled);
      await security.withAccount(
        request,
        async (user, session) => {
          if (user.role === 'admin') {
            await collections(db).settings.updateOne(
              { _id: 'admin-guard' },
              { $inc: { revision: 1 } },
              { session },
            );
            if (
              !(await collections(db).users.findOne(
                {
                  _id: { $ne: user._id },
                  role: 'admin',
                  emailVerified: true,
                  state: { $nin: ['deleting', 'suspended'] },
                },
                { session },
              ))
            )
              throw securityError(
                'Transfer administrator access before deleting the last administrator account.',
                409,
              );
          }
          await collections(db).users.updateOne(
            { _id: user._id },
            { $set: { state: 'deleting' }, $inc: { authVersion: 1 } },
            { session },
          );
          await vaultCollections(db).vaults.updateMany(
            { ownerId: user._id },
            { $set: { state: 'deleting' }, $inc: { writeRevision: 1 } },
            { session },
          );
          await collections(db).sessions.deleteMany({ userId: user._id }, { session });
          for (const name of ['agent_tokens', 'oauth_refresh', 'oauth_codes', 'oauth_requests'])
            await db.collection(name).deleteMany({ ownerId: user._id }, { session });
          await db.collection('email_tokens').deleteMany({ userId: user._id }, { session });
          await jobs.updateOne(
            { _id: user._id },
            {
              $setOnInsert: {
                state: 'pending',
                requestedAt: new Date(),
                notBefore: new Date(Date.now() + 300_000),
                attempts: 0,
              },
            },
            { upsert: true, session },
          );
        },
        false,
      );
      reply.clearCookie('helious_session', {
        path: '/',
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'lax',
      });
      return reply.code(202).send({
        deletionRequested: true,
        message:
          'Access has ended. Permanent erasure is queued and normally completes within 24 hours. Device copies, downloaded exports, provider records and separately retained backups require their own deletion.',
      });
    },
  );
  let running: Promise<void> | undefined;
  const sweep = () => {
    running ??= processAccountDeletions(db)
      .catch(() => {
        app.log.error('Account erasure remains queued; investigate the deletion worker.');
      })
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(sweep, 30_000);
  timer.unref();
  sweep();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await running;
  });
}
