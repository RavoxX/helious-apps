import { ObjectId, type Db } from 'mongodb';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { securityCollections } from './security-db.js';
import { securityError, type SecurityService } from './security-service.js';
import type { SecretsService } from './secrets-service.js';
import type { AuditRecord } from './secret-audit.js';
const id = z.string().regex(/^[a-f0-9]{24}$/);
const proof = {
  password: z.string().min(1).max(128).optional(),
  code: z.string().min(1).max(128).optional(),
};
const fields = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['password', 'api-key', 'ssh-key', 'env', 'other']),
  spaceId: id,
  agentAccess: z.enum(['none', 'read']).default('none'),
  requireApproval: z.boolean().default(true),
  value: z.string().min(1).max(65536).optional(),
};
const setupBody = z.object({ password: z.string().min(1).max(128) }).strict();
const enableBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const proofBody = z.object(proof).strict();
const createBody = z.object({ ...fields, value: z.string().min(1).max(65536), ...proof }).strict();
const updateBody = z
  .object({ ...fields, revision: z.number().int().positive(), ...proof })
  .strict();
const removeBody = z.object({ revision: z.number().int().positive(), ...proof }).strict();
const readBody = z.object({ ...proof, approvalId: id.optional() }).strict();
const decisionBody = z.object({ approved: z.boolean(), ...proof }).strict();
const json = (value: z.ZodType) => z.toJSONSchema(value, { target: 'draft-7', io: 'input' });
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw securityError('Check the submitted fields and try again.', 400);
  return result.data;
};
type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export async function registerSecurityRoutes(
  app: FastifyInstance,
  db: Db,
  authenticate: Guard,
  setCookie: (reply: FastifyReply, token: string, expires: Date) => unknown,
  security: SecurityService,
  secrets: SecretsService,
) {
  const store = securityCollections(db);
  app.addHook('onRoute', (route) => {
    if (!route.schema?.tags?.includes('Security')) return;
    const names = [...route.url.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]!);
    if (names.length)
      route.schema.params = {
        type: 'object',
        required: names,
        properties: Object.fromEntries(
          names.map((name) => [name, { type: 'string', pattern: '^[a-f0-9]{24}$' }]),
        ),
      };
  });
  const opts = (summary: string, mutation = false, body?: z.ZodType) => ({
    preHandler: authenticate,
    config: mutation ? { rateLimit: { max: 20, timeWindow: '15 minutes' } } : {},
    schema: {
      tags: ['Security'],
      summary,
      security: [{ session: [] }],
      ...(body ? { body: json(body) } : {}),
    },
  });
  app.get(
    '/api/security/status',
    opts('Two-factor status and pending approval count'),
    async (request) => {
      const user = request.auth!.user;
      const credential = await store.credentials.findOne(
        { _id: user._id },
        { projection: { recoveryHashes: 1 } },
      );
      return {
        totpEnabled: !!user.totpEnabled,
        recoveryCodesRemaining: credential?.recoveryHashes.length ?? 0,
        pendingApprovals: await store.approvals.countDocuments({
          ownerId: user._id,
          state: 'pending',
          expiresAt: { $gt: new Date() },
        }),
      };
    },
  );
  app.post(
    '/api/account/totp/setup',
    opts('Start password-confirmed authenticator enrollment', true, setupBody),
    async (request) => security.setup(request, parse(setupBody, request.body).password),
  );
  app.delete(
    '/api/account/totp/setup',
    opts('Discard pending authenticator enrollment', true),
    async (request) => {
      await store.enrollments.deleteOne({
        userId: request.auth!.user._id,
        sessionId: request.auth!.session._id,
      });
      return { ok: true };
    },
  );
  app.post(
    '/api/account/totp/enable',
    opts('Confirm enrollment and show recovery codes once', true, enableBody),
    async (request, reply) => {
      const result = await security.enable(request, parse(enableBody, request.body).code);
      setCookie(reply, result.sessionToken, request.auth!.session.expiresAt);
      return { recoveryCodes: result.recoveryCodes };
    },
  );
  app.post(
    '/api/account/totp/disable',
    opts('Disable authenticator after deleting stored secrets', true, proofBody),
    async (request, reply) => {
      const result = await security.disable(request, parse(z.object(proof).strict(), request.body));
      setCookie(reply, result.sessionToken, request.auth!.session.expiresAt);
      return { ok: true };
    },
  );
  app.post(
    '/api/account/totp/recovery-codes',
    opts('Replace recovery codes with password and unused factor', true, proofBody),
    async (request) => security.recovery(request, parse(z.object(proof).strict(), request.body)),
  );
  app.get(
    '/api/security/audit',
    opts('Read an owner-scoped page of the append-only audit log'),
    async (request) => {
      const q = parse(
        z
          .object({
            before: z.coerce.number().int().positive().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
            vaultId: id.optional(),
          })
          .strict(),
        request.query,
      );
      const rows = await db
        .collection<AuditRecord>('secret_audit')
        .find({
          ownerId: request.auth!.user._id,
          ...(q.before ? { seq: { $lt: q.before } } : {}),
          ...(q.vaultId ? { vaultId: new ObjectId(q.vaultId) } : {}),
        })
        .sort({ seq: -1 })
        .limit(q.limit)
        .toArray();
      return {
        events: rows.map((row) => ({
          id: row._id.toHexString(),
          seq: row.seq,
          at: row.at.toISOString(),
          actor: row.actor,
          ip: row.ip,
          action: row.action,
          outcome: row.outcome,
          vaultId: row.vaultId?.toHexString(),
          spaceId: row.spaceId?.toHexString(),
          secretId: row.secretId?.toHexString(),
          approvalId: row.approvalId?.toHexString(),
          previousHash: row.previousHash,
          hash: row.hash,
        })),
        nextBefore: rows.length === q.limit ? rows.at(-1)!.seq : null,
      };
    },
  );
  app.get(
    '/api/security/approvals',
    opts('List live pending requests for this owner'),
    async (request) => {
      if (!request.auth!.user.totpEnabled) return { approvals: [] };
      const rows = await store.approvals
        .find({ ownerId: request.auth!.user._id, state: 'pending', expiresAt: { $gt: new Date() } })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      return {
        approvals: await Promise.all(
          rows.map(async (row) => ({
            id: row._id.toHexString(),
            agentId: row.agentId,
            secretId: row.secretId.toHexString(),
            secretName:
              (
                await store.secrets.findOne(
                  { _id: row.secretId, ownerId: row.ownerId },
                  { projection: { name: 1 } },
                )
              )?.name ?? 'Deleted secret',
            expiresAt: row.expiresAt.toISOString(),
          })),
        ),
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/security/approvals/:id/decision',
    opts('Approve once with reauthentication, or deny a pending request', true, decisionBody),
    async (request) => {
      const data = parse(z.object({ approved: z.boolean(), ...proof }).strict(), request.body);
      return secrets.decide(request, parse(id, request.params.id), data.approved, data);
    },
  );
  const path = '/api/vaults/:vaultId/secrets';
  type Params = { vaultId: string; id: string };
  const params = (request: FastifyRequest) =>
    parse(z.object({ vaultId: id, id: id.optional() }), request.params);
  app.get<{ Params: Params }>(
    path,
    opts('List secret metadata only; requires two-factor authentication'),
    async (request) => {
      const p = params(request),
        q = parse(z.object({ spaceId: id.optional() }).strict(), request.query);
      return secrets.list(request, p.vaultId, q.spaceId);
    },
  );
  const writeOpts = (summary: string, body: z.ZodType) => ({
    ...opts(summary, true, body),
    bodyLimit: 300000,
  });
  app.post<{ Params: Params }>(
    path,
    writeOpts('Encrypt a new secret with a fresh data key', createBody),
    async (request, reply) => {
      const p = params(request),
        data = parse(
          z.object({ ...fields, value: z.string().min(1).max(65536), ...proof }).strict(),
          request.body,
        );
      return reply.code(201).send(await secrets.create(request, p.vaultId, data, data));
    },
  );
  app.patch<{ Params: Params }>(
    `${path}/:id`,
    writeOpts('Update a secret with an expected revision and reauthentication', updateBody),
    async (request) => {
      const p = params(request),
        data = parse(
          z.object({ ...fields, revision: z.number().int().positive(), ...proof }).strict(),
          request.body,
        );
      return secrets.update(request, p.vaultId, p.id!, data.revision, data, data);
    },
  );
  app.delete<{ Params: Params }>(
    `${path}/:id`,
    opts('Delete encrypted payload and invalidate approvals', true, removeBody),
    async (request) => {
      const p = params(request),
        data = parse(
          z.object({ revision: z.number().int().positive(), ...proof }).strict(),
          request.body,
        );
      return secrets.remove(request, p.vaultId, p.id!, data.revision, data);
    },
  );
  app.post<{ Params: Params }>(
    `${path}/:id/access`,
    opts('Audited secret reveal after reauthentication', true, readBody),
    async (request) => {
      const p = params(request),
        data = parse(z.object({ ...proof, approvalId: id.optional() }).strict(), request.body);
      return secrets.read(request, p.vaultId, p.id!, data, data.approvalId);
    },
  );
}
