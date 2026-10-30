import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../apps/server/src/app.js';
import { connectDatabase } from '../apps/server/src/db.js';
import { loadConfig } from '../apps/server/src/config.js';
import { MemoryEmailService } from '../apps/server/src/email.js';

const port = Number(process.env.PORT ?? 3000);
const mongo = await MongoMemoryReplSet.create({
  binary: { version: '7.0.24' },
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const { client, db } = await connectDatabase(mongo.getUri('helious-preview'));
const config = loadConfig({
  NODE_ENV: 'development',
  REGISTRATION_MIN_AGE: '0', // Isolated legacy-flow fixture; policy enforcement has separate tests.
  PORT: String(port),
  HELIOUS_MASTER_KEY: randomBytes(32).toString('hex'),
  PUBLIC_URL: `http://localhost:${port}`,
  COOKIE_SECURE: 'false',
  TRUST_PROXY: process.env.HELIOUS_E2E_EMAIL === '1' ? '127.0.0.1/32' : '',
});
const testMail = process.env.HELIOUS_E2E_EMAIL === '1' ? new MemoryEmailService() : undefined;
const app = await buildApp(config, db, {
  logger: false,
  ...(testMail ? { emailService: testMail } : {}),
});
// Only this explicitly enabled, ephemeral loopback test runner exposes a mock inbox.
// Normal server startup never registers these routes.
if (testMail) {
  app.get<{ Querystring: { email: string } }>('/__test/emails', async (request) => ({
    messages: testMail.messages.filter((message) => message.to === request.query.email),
  }));
  app.post<{ Body: { token: string } }>('/__test/expire-token', async (request) => {
    const { emailTokenHash } = await import('../apps/server/src/email-tokens.js');
    await db
      .collection('email_tokens')
      .updateOne(
        { hash: emailTokenHash(request.body.token) },
        { $set: { expiresAt: new Date(0) } },
      );
    return { ok: true };
  });
}
app.addHook('onClose', async () => {
  await client.close();
  await mongo.stop();
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
}
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
await app.listen({ host: '127.0.0.1', port });
console.log(`Helious temporary preview: http://localhost:${port}`);
console.log(
  'Temporary MongoDB; accounts and data disappear when stopped. Not a production server.',
);
