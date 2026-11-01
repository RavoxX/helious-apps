import { createHash } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import formbody from '@fastify/formbody';
import { z } from 'zod';
import type { Config } from './config.js';
import { collections } from './db.js';
import {
  opaque,
  digest,
  constantEqual,
  agentStore,
  validateGrants,
  type Grants,
  type AgentTokens,
  type AgentScope,
} from './agent-tokens.js';
import { securityError, type SecurityService } from './security-service.js';
export const scopeSchema = z
  .string()
  .regex(/^(?:notes:(?:read|write)|secrets:create|secrets:read:[a-f0-9]{24})$/);
export const grantsSchema = {
  vaultIds: z
    .array(z.string().regex(/^[a-f0-9]{24}$/))
    .min(1)
    .max(30),
  spaceIds: z
    .array(z.string().regex(/^[a-f0-9]{24}$/))
    .min(1)
    .max(100),
  scopes: z.array(scopeSchema).min(1).max(100),
  personalConsent: z
    .array(z.string().regex(/^[a-f0-9]{24}$/))
    .max(100)
    .default([]),
};
interface OAuthClient {
  _id: string;
  clientName: string;
  redirectUris: string[];
  createdAt: Date;
  expiresAt: Date;
}
interface AuthorizationRequest {
  _id: ObjectId;
  hash: string;
  clientId: string;
  redirectUri: string;
  scopes: AgentScope[];
  challenge: string;
  state?: string;
  resource: string;
  expiresAt: Date;
  ownerId?: ObjectId;
  authVersion?: number;
  usedAt?: Date;
}
interface AuthorizationCode {
  _id: ObjectId;
  hash: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string;
  ownerId: ObjectId;
  authVersion: number;
  grants: Grants;
  name: string;
  expiresAt: Date;
  usedAt?: Date;
  familyId: string;
}
interface RefreshToken {
  _id: ObjectId;
  hash: string;
  clientId: string;
  ownerId: ObjectId;
  authVersion: number;
  resource: string;
  grants: Grants;
  name: string;
  familyId: string;
  expiresAt: Date;
  usedAt?: Date;
  revokedAt?: Date;
}
const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
  const result = schema.safeParse(value);
  if (!result.success) throw securityError('Invalid authorization request.', 400);
  return result.data;
};
function redirectAllowed(value: string) {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      value.length <= 2048 &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
export async function registerOAuth(
  app: FastifyInstance,
  db: Db,
  config: Config,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  tokens: AgentTokens,
  security: SecurityService,
) {
  const clients = db.collection<OAuthClient>('oauth_clients'),
    requests = db.collection<AuthorizationRequest>('oauth_requests'),
    codes = db.collection<AuthorizationCode>('oauth_codes'),
    refresh = db.collection<RefreshToken>('oauth_refresh'),
    resource = `${config.PUBLIC_URL}/mcp`;
  await Promise.all([
    clients.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    requests.createIndex({ hash: 1 }, { unique: true }),
    requests.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    codes.createIndex({ hash: 1 }, { unique: true }),
    codes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    refresh.createIndex({ hash: 1 }, { unique: true }),
    refresh.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    refresh.createIndex({ familyId: 1 }),
  ]);
  await app.register(formbody);
  const protocol = {
    config: {
      credentialTransport: 'oauth' as const,
      rateLimit: { max: 30, timeWindow: '15 minutes' },
    },
  };
  const jsonHeaders = (reply: FastifyReply) =>
    reply
      .header('Cache-Control', 'no-store')
      .header('Pragma', 'no-cache')
      .header('Referrer-Policy', 'no-referrer');
  const protectedMetadata = {
    resource,
    authorization_servers: [config.PUBLIC_URL],
    bearer_methods_supported: ['header'],
    scopes_supported: ['notes:read', 'notes:write', 'secrets:create'],
    resource_name: 'Helious memory',
  };
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ])
    app.get(path, async () => protectedMetadata);
  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer: config.PUBLIC_URL,
    authorization_endpoint: `${config.PUBLIC_URL}/oauth/authorize`,
    token_endpoint: `${config.PUBLIC_URL}/oauth/token`,
    registration_endpoint: `${config.PUBLIC_URL}/oauth/register`,
    revocation_endpoint: `${config.PUBLIC_URL}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['notes:read', 'notes:write', 'secrets:create'],
  }));
  app.post('/oauth/register', protocol, async (request, reply) => {
    const body = parse(
      z.object({
        client_name: z.string().trim().min(1).max(100).default('MCP client'),
        redirect_uris: z.array(z.string().refine(redirectAllowed)).min(1).max(5),
        token_endpoint_auth_method: z.literal('none').default('none'),
        grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
        response_types: z.array(z.literal('code')).optional(),
        client_uri: z.string().max(2048).optional(),
        logo_uri: z.string().max(2048).optional(),
        scope: z.string().max(2048).optional(),
      }),
      request.body,
    );
    if ((await clients.estimatedDocumentCount()) > 10000)
      throw securityError('Client registration is temporarily unavailable.', 503);
    const id = opaque('hel_client_'),
      now = new Date();
    await clients.insertOne({
      _id: id,
      clientName: body.client_name,
      redirectUris: [...new Set(body.redirect_uris)],
      createdAt: now,
      expiresAt: new Date(now.getTime() + 180 * 86400000),
    });
    return jsonHeaders(reply)
      .code(201)
      .send({
        client_id: id,
        client_name: body.client_name,
        redirect_uris: body.redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_id_issued_at: Math.floor(now.getTime() / 1000),
      });
  });
  app.get('/oauth/authorize', protocol, async (request, reply) => {
    const body = parse(
      z
        .object({
          response_type: z.literal('code'),
          client_id: z.string().max(100),
          redirect_uri: z.string().max(2048),
          code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          code_challenge_method: z.literal('S256'),
          scope: z.string().min(1).max(2048),
          state: z.string().max(1024).optional(),
          resource: z.literal(resource),
        })
        .strict(),
      request.query,
    );
    const client = await clients.findOne({ _id: body.client_id, expiresAt: { $gt: new Date() } });
    if (!client || !client.redirectUris.includes(body.redirect_uri))
      throw securityError('Unknown client or redirect URI.', 400);
    await clients.updateOne(
      { _id: client._id },
      { $set: { expiresAt: new Date(Date.now() + 180 * 86400000) } },
    );
    const scopes = [...new Set(body.scope.split(' ').filter(Boolean))];
    if (scopes.includes('notes:write') && !scopes.includes('notes:read'))
      throw securityError('Note writing also requires notes:read.', 400);
    if (scopes.length > 100 || scopes.some((scope) => !scopeSchema.safeParse(scope).success))
      throw securityError('Unsupported scopes.', 400);
    const raw = opaque();
    await requests.insertOne({
      _id: new ObjectId(),
      hash: digest(raw),
      clientId: client._id,
      redirectUri: body.redirect_uri,
      scopes: scopes as AgentScope[],
      challenge: body.code_challenge,
      resource,
      expiresAt: new Date(Date.now() + 600000),
      ...(body.state ? { state: body.state } : {}),
    });
    return jsonHeaders(reply).redirect(`/app/oauth/consent?request=${raw}`);
  });
  app.get<{ Params: { id: string } }>(
    '/api/oauth/requests/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      jsonHeaders(reply);
      const raw = parse(z.string().regex(/^[A-Za-z0-9_-]{43}$/), request.params.id),
        user = request.auth!.user;
      const item = await requests.findOneAndUpdate(
        {
          hash: digest(raw),
          usedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
          $or: [
            { ownerId: { $exists: false } },
            { ownerId: user._id, authVersion: user.authVersion },
          ],
        },
        { $set: { ownerId: user._id, authVersion: user.authVersion } },
        { returnDocument: 'after' },
      );
      const client = item
        ? await clients.findOne({ _id: item.clientId, expiresAt: { $gt: new Date() } })
        : null;
      if (!item || !client)
        throw securityError(
          'This connection request expired or was already handled. Start again from your AI tool.',
          400,
        );
      return {
        clientName: client.clientName,
        redirectUri: item.redirectUri,
        scopes: item.scopes,
        expiresAt: item.expiresAt.toISOString(),
        resource,
      };
    },
  );
  app.post(
    '/api/oauth/consent',
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = parse(
          z
            .object({
              request: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
              approved: z.boolean(),
              password: z.string().max(128).optional(),
              ...grantsSchema,
            })
            .partial({ vaultIds: true, spaceIds: true, scopes: true })
            .strict(),
          request.body,
        ),
        user = request.auth!.user;
      const result = await security.withAccount(
        request,
        async (fresh, session) => {
          const item = await requests.findOneAndUpdate(
            {
              hash: digest(body.request),
              ownerId: fresh._id,
              authVersion: fresh.authVersion,
              usedAt: { $exists: false },
              expiresAt: { $gt: new Date() },
            },
            { $set: { usedAt: new Date() } },
            { session, returnDocument: 'after' },
          );
          const client = item
            ? await clients.findOne(
                { _id: item.clientId, expiresAt: { $gt: new Date() } },
                { session },
              )
            : null;
          if (!item || !client) throw securityError('Connection request expired or changed.', 400);
          const redirect = new URL(item.redirectUri);
          redirect.searchParams.set('iss', config.PUBLIC_URL);
          if (item.state) redirect.searchParams.set('state', item.state);
          if (!body.approved) {
            redirect.searchParams.set('error', 'access_denied');
            return { redirect: redirect.href };
          }
          if (
            !body.vaultIds ||
            !body.spaceIds ||
            !body.scopes ||
            body.scopes.some((scope) => !item.scopes.includes(scope as AgentScope))
          )
            throw securityError('Choose a subset of the requested actions.', 400);
          const grants = await validateGrants(
            db,
            fresh._id,
            {
              vaultIds: body.vaultIds,
              spaceIds: body.spaceIds,
              scopes: body.scopes as AgentScope[],
            },
            body.personalConsent,
            session,
          );
          const raw = opaque(),
            familyId = opaque('family_');
          await codes.insertOne(
            {
              _id: new ObjectId(),
              hash: digest(raw),
              ownerId: fresh._id,
              authVersion: fresh.authVersion,
              clientId: item.clientId,
              redirectUri: item.redirectUri,
              challenge: item.challenge,
              resource,
              grants,
              name: client.clientName,
              expiresAt: new Date(Date.now() + 300000),
              familyId,
            },
            { session },
          );
          redirect.searchParams.set('code', raw);
          return { redirect: redirect.href };
        },
        false,
      );
      // Consent is authenticated and CSRF-protected. Secret delegation additionally requires an MFA session.
      if (
        body.approved &&
        body.scopes?.some((scope) => scope.startsWith('secrets:')) &&
        !user.totpEnabled
      )
        throw securityError('Enable two-factor authentication before sharing secrets.', 403);
      return jsonHeaders(reply).send(result);
    },
  );
  async function revokeFamily(familyId: string) {
    const member =
      (await refresh.findOne({ familyId })) ??
      (await agentStore(db).findOne({ familyId })) ??
      (await codes.findOne({ familyId }));
    if (!member) return;
    await db.client.withSession((session) =>
      session.withTransaction(async () => {
        await collections(db).users.updateOne(
          { _id: member.ownerId },
          { $inc: { securityRevision: 1 } },
          { session },
        );
        await agentStore(db).updateMany(
          { familyId },
          { $set: { revokedAt: new Date() } },
          { session },
        );
        await refresh.updateMany({ familyId }, { $set: { revokedAt: new Date() } }, { session });
      }),
    );
  }
  app.post('/oauth/token', protocol, async (request, reply) => {
    jsonHeaders(reply);
    const body = parse(
      z.object({
        grant_type: z.enum(['authorization_code', 'refresh_token']),
        client_id: z.string().max(100),
        code: z.string().max(100).optional(),
        redirect_uri: z.string().max(2048).optional(),
        code_verifier: z
          .string()
          .regex(/^[A-Za-z0-9._~-]{43,128}$/)
          .optional(),
        refresh_token: z.string().max(100).optional(),
        resource: z.literal(resource),
        scope: z.string().max(2048).optional(),
      }),
      request.body,
    );
    const client = await clients.findOne({ _id: body.client_id, expiresAt: { $gt: new Date() } });
    if (!client) return reply.code(400).send({ error: 'invalid_client' });
    await clients.updateOne(
      { _id: client._id },
      { $set: { expiresAt: new Date(Date.now() + 180 * 86400000) } },
    );
    const candidate =
      body.grant_type === 'authorization_code'
        ? await codes.findOne({ hash: digest(body.code ?? ''), clientId: client._id })
        : await refresh.findOne({ hash: digest(body.refresh_token ?? ''), clientId: client._id });
    if (
      !candidate ||
      candidate.expiresAt <= new Date() ||
      !constantEqual(
        candidate.hash,
        digest((body.grant_type === 'authorization_code' ? body.code : body.refresh_token) ?? ''),
      )
    )
      return reply.code(400).send({ error: 'invalid_grant' });
    if (
      'challenge' in candidate &&
      (body.redirect_uri !== candidate.redirectUri ||
        !body.code_verifier ||
        !constantEqual(
          candidate.challenge,
          createHash('sha256').update(body.code_verifier).digest('base64url'),
        ))
    )
      return reply.code(400).send({ error: 'invalid_grant' });
    if (candidate.usedAt || ('revokedAt' in candidate && candidate.revokedAt)) {
      await revokeFamily(candidate.familyId);
      return reply.code(400).send({ error: 'invalid_grant' });
    }
    const scopes = body.scope
      ? [...new Set(body.scope.split(' ').filter(Boolean))]
      : candidate.grants.scopes;
    if (
      !scopes.length ||
      (scopes.includes('notes:write') && !scopes.includes('notes:read')) ||
      scopes.some((scope) => !candidate.grants.scopes.includes(scope as AgentScope))
    )
      return reply.code(400).send({ error: 'invalid_scope' });
    try {
      const result = await db.client.withSession((session) =>
        session.withTransaction(async () => {
          const user = await collections(db).users.findOneAndUpdate(
            { _id: candidate.ownerId, authVersion: candidate.authVersion, emailVerified: true },
            { $inc: { securityRevision: 1 } },
            { session, returnDocument: 'after' },
          );
          if (!user) throw securityError('Invalid grant.', 400);
          const consumed =
            body.grant_type === 'authorization_code'
              ? await codes.updateOne(
                  {
                    _id: candidate._id,
                    usedAt: { $exists: false },
                    expiresAt: { $gt: new Date() },
                  },
                  { $set: { usedAt: new Date() } },
                  { session },
                )
              : await refresh.updateOne(
                  {
                    _id: candidate._id,
                    usedAt: { $exists: false },
                    revokedAt: { $exists: false },
                    expiresAt: { $gt: new Date() },
                  },
                  { $set: { usedAt: new Date() } },
                  { session },
                );
          if (!consumed.modifiedCount) throw securityError('Invalid grant.', 400);
          const expiry =
              body.grant_type === 'authorization_code'
                ? new Date(Date.now() + 7 * 86400000)
                : candidate.expiresAt,
            grants = { ...candidate.grants, scopes: scopes as AgentScope[] };
          const issued = await tokens.issue(
            user._id,
            candidate.name,
            grants,
            new Date(Math.min(Date.now() + 3600000, expiry.getTime())),
            {
              session,
              clientId: client._id,
              familyId: candidate.familyId,
              connectionExpiresAt: expiry,
            },
          );
          const next = opaque('hel_rt_');
          await refresh.insertOne(
            {
              _id: new ObjectId(),
              hash: digest(next),
              clientId: client._id,
              ownerId: user._id,
              authVersion: user.authVersion,
              resource,
              grants,
              name: candidate.name,
              familyId: candidate.familyId,
              expiresAt: expiry,
            },
            { session },
          );
          return {
            access_token: issued.raw,
            token_type: 'Bearer',
            expires_in: Math.max(
              1,
              Math.floor((issued.token.expiresAt.getTime() - Date.now()) / 1000),
            ),
            refresh_token: next,
            scope: grants.scopes.join(' '),
          };
        }),
      );
      return result;
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error && error.statusCode === 400) {
        await revokeFamily(candidate.familyId);
        return reply.code(400).send({ error: 'invalid_grant' });
      }
      throw error;
    }
  });
  app.post('/oauth/revoke', protocol, async (request, reply) => {
    const body = parse(
      z.object({
        token: z.string().max(200),
        client_id: z.string().max(100),
        token_type_hint: z.string().optional(),
      }),
      request.body,
    );
    const hash = digest(body.token),
      token =
        (await agentStore(db).findOne({ hash, clientId: body.client_id })) ??
        (await refresh.findOne({ hash, clientId: body.client_id }));
    if (token?.familyId) await revokeFamily(token.familyId);
    return jsonHeaders(reply).send({});
  });
}
