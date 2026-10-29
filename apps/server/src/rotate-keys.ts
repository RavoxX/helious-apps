import { MongoClient } from 'mongodb';
import { loadConfig } from './config.js';
import { KeyRing } from './encryption.js';
import { rotateKeys } from './key-rotation.js';
const args = process.argv.slice(2);
if (args.some((arg) => !['--apply', '--dry-run'].includes(arg)) || args.length > 1)
  throw new Error('Usage: rotate-keys [--dry-run|--apply]');
const config = loadConfig(),
  client = new MongoClient(config.MONGO_URI);
try {
  await client.connect();
  console.log(
    await rotateKeys(
      client.db(),
      new KeyRing(
        config.HELIOUS_MASTER_KEY_ID,
        config.HELIOUS_MASTER_KEY,
        config.previousMasterKeys,
      ),
      args.includes('--apply'),
    ),
  );
} finally {
  await client.close();
}
