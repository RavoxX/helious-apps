import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hkdfSync } from 'node:crypto';
import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import type { Db } from 'mongodb';
import type { Config } from './config.js';
import { initializeDatabase } from './db.js';
import { registerAuth } from './auth.js';
import { registerVaults } from './vaults.js';
import { createEmailService, type EmailService } from './email.js';
import { KeyRing } from './encryption.js';
import { initializeSecurityDatabase } from './security-db.js';
import { createSecurityService } from './security-service.js';
import { createSecretsService } from './secrets-service.js';
import { registerSecurityRoutes } from './security-routes.js';
import { initializeAgents, createAgentTokens } from './agent-tokens.js';
import { registerAgentRoutes } from './agent-routes.js';
import { registerOAuth } from './oauth.js';
import { registerMcp } from './mcp-http.js';
import { registerSync } from './sync.js';
import { registerAccountRights } from './account-rights.js';
import { registerSecurityEvents } from './security-events.js';

export async function buildApp(
  config: Config,
  db: Db,
  options: { logger?: boolean; staticFiles?: boolean; emailService?: EmailService } = {},
) {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers.x-csrf-token',
            'res.headers.set-cookie',
            'req.url',
            'req.remoteAddress',
            'req.remotePort',
            'req.ip',
          ],
        }
      : false,
    trustProxy: config.TRUST_PROXY
      ? config.TRUST_PROXY.split(',').map((cidr) => cidr.trim())
      : false,
    bodyLimit: 16384,
  });
  // Register before routes/plugins so their route contexts inherit this error envelope.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation)
      return reply.code(400).send({ error: 'Check the submitted fields and try again.' });
    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({
        error: error.message,
        ...(['TOTP_REQUIRED', 'REAUTH_REQUIRED'].includes(error.code) ? { code: error.code } : {}),
      });
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: 'Something went wrong. Please try again.' });
  });
  const store = await initializeDatabase(db);
  await registerSecurityEvents(app, db);
  const ring = new KeyRing(
    config.HELIOUS_MASTER_KEY_ID,
    config.HELIOUS_MASTER_KEY,
    config.previousMasterKeys,
  );
  await initializeSecurityDatabase(db, ring);
  const security = createSecurityService(db, ring);
  await initializeAgents(db);
  const tokens = createAgentTokens(db);
  await app.register(cookie, {
    secret: Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(config.HELIOUS_MASTER_KEY, 'hex'),
        'helious',
        'csrf-cookie-v1',
        32,
      ),
    ).toString('hex'),
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
    strictTransportSecurity: config.secureCookies
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Apply API limits to API traffic; a long visual page may legitimately load many assets.
    allowList: (request) =>
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/mcp') &&
      !request.url.startsWith('/oauth/'),
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Helious API',
        version: '0.8.0',
        description:
          'Helious accounts and knowledge API. Mutations require an exact Origin and X-CSRF-Token from /api/auth/csrf. Attachments use multipart; other bodies use JSON.',
      },
      servers: [{ url: config.PUBLIC_URL }],
      components: {
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'helious_session' } },
      },
    },
  });

  app.get(
    '/api/health',
    { schema: { tags: ['System'], summary: 'Check application and MongoDB readiness' } },
    async (_request, reply) => {
      try {
        await db.command({ ping: 1 });
        return { status: 'ok', service: 'helious', phase: 8 };
      } catch {
        return reply.code(503).send({ status: 'unavailable' });
      }
    },
  );
  const { authenticate, setSessionCookie } = await registerAuth(
    app,
    store,
    config,
    options.emailService ?? createEmailService(config),
    db,
    security,
  );
  await registerVaults(app, db, authenticate);
  await registerAccountRights(app, db, config, authenticate, security);
  await registerSync(app, db, authenticate, security);
  await registerAgentRoutes(app, db, config, authenticate, tokens, security);
  await registerOAuth(app, db, config, authenticate, tokens, security);
  await registerMcp(app, db, config, ring, security, tokens);
  await registerSecurityRoutes(
    app,
    db,
    authenticate,
    setSessionCookie,
    security,
    createSecretsService(db, ring, security),
  );
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  if (options.staticFiles !== false) {
    const appsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const web = resolve(appsRoot, 'web/dist');
    const docs = resolve(appsRoot, 'docs/.vitepress/dist');
    app.get('/', async (_request, reply) => reply.redirect('/app/'));
    if (existsSync(web)) {
      for (const path of ['/verify-email', '/reset-password', '/forgot-password'])
        app.get(path, async (_request, reply) =>
          reply
            .header('Referrer-Policy', 'no-referrer')
            .header('Cache-Control', 'no-store')
            .sendFile('index.html', web),
        );
      await app.register(fastifyStatic, {
        root: web,
        prefix: '/app/',
        decorateReply: true,
      });
      app.get('/app', async (_request, reply) => reply.redirect('/app/'));
    }
    if (existsSync(docs)) {
      await app.register(fastifyStatic, {
        root: docs,
        prefix: '/docs/',
        decorateReply: !existsSync(web),
        extensions: ['html'],
      });
      app.get('/docs', async (_request, reply) => reply.redirect('/docs/'));
    }
    app.setNotFoundHandler(async (request, reply) => {
      if (
        request.method === 'GET' &&
        request.url.split('?')[0]?.startsWith('/app/') &&
        !request.url.includes('.')
      ) {
        if (existsSync(web)) return reply.sendFile('index.html', web);
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return app;
}
