import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { buildApp } from './app.js';

async function main() {
  const config = loadConfig(); // Validate key and origin before opening a socket.
  const { client, db } = await connectDatabase(config.MONGO_URI);
  try {
    const app = await buildApp(config, db, { logger: true });
    app.addHook('onClose', async () => {
      await client.close();
    });
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await app.close();
    };
    process.once('SIGINT', () => {
      void shutdown();
    });
    process.once('SIGTERM', () => {
      void shutdown();
    });
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    await client.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Server startup failed');
  process.exitCode = 1;
});
