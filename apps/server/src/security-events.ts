import type { Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';

export const SECURITY_EVENT_RETENTION_MS = 14 * 86400_000;
/** Minimal security events. No request URLs, query tokens, email addresses or bodies. */
export async function registerSecurityEvents(app: FastifyInstance, db: Db) {
  const events = db.collection('security_events');
  await events.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await events.createIndex({ userId: 1, at: -1 });
  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const route = request.routeOptions.url ?? '/unmatched-api';
    if (
      reply.statusCode < 400 &&
      !/^\/api\/(?:auth\/(?:login|register|logout)|account\/|security\/)/.test(route)
    )
      return;
    const at = new Date();
    try {
      await events.insertOne({
        at,
        expiresAt: new Date(at.getTime() + SECURITY_EVENT_RETENTION_MS),
        ip: request.ip.slice(0, 100),
        method: request.method,
        route,
        status: reply.statusCode,
        ...(request.auth ? { userId: request.auth.user._id } : {}),
      });
    } catch {
      app.log.error('Unable to record a security event');
    }
  });
}
