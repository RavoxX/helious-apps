import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMemoryServer } from '@helious/mcp';
import type { Config } from './config.js';
import type { KeyRing } from './encryption.js';
import type { SecurityService } from './security-service.js';
import type { AgentTokens } from './agent-tokens.js';
import { createAgentBackend } from './mcp-backend.js';
export async function registerMcp(
  app: FastifyInstance,
  db: Db,
  config: Config,
  ring: KeyRing,
  security: SecurityService,
  tokens: AgentTokens,
) {
  const backend = await createAgentBackend(db, ring, security, tokens),
    host = new URL(config.PUBLIC_URL).host;
  app.addHook('onClose', () => backend.close());
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    bodyLimit: 4_100_000,
    config: { credentialTransport: 'bearer', rateLimit: { max: 180, timeWindow: '1 minute' } },
    schema: { tags: ['MCP'], summary: 'Authenticated MCP Streamable HTTP endpoint' },
    handler: async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (request.headers.origin && request.headers.origin !== config.PUBLIC_URL)
        return reply.code(403).send({ error: 'Origin is not permitted.' });
      if (request.headers.host !== host)
        return reply.code(403).send({ error: 'Host is not permitted.' });
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith('Bearer '))
        return reply
          .header(
            'WWW-Authenticate',
            `Bearer resource_metadata="${config.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`,
          )
          .code(401)
          .send({ error: 'An agent token is required.' });
      const raw = authorization.slice(7);
      try {
        await tokens.authenticate(raw);
      } catch {
        return reply
          .header(
            'WWW-Authenticate',
            `Bearer error="invalid_token", resource_metadata="${config.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`,
          )
          .code(401)
          .send({ error: 'Invalid or expired agent token.' });
      }
      if (request.method !== 'POST')
        return reply
          .header('Allow', 'POST')
          .code(405)
          .send({ error: 'This stateless MCP endpoint accepts POST requests.' });
      const server = createMemoryServer(backend.forToken(raw, request.ip)),
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
      reply.hijack();
      for (const [name, value] of Object.entries(reply.getHeaders()))
        if (value !== undefined) reply.raw.setHeader(name, value);
      const close = () => {
        void transport.close();
        void server.close();
      };
      reply.raw.once('close', close);
      try {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch {
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'content-type': 'application/json' });
          reply.raw.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'MCP request failed.' },
              id: null,
            }),
          );
        } else reply.raw.end();
      } finally {
        close();
      }
    },
  });
}
