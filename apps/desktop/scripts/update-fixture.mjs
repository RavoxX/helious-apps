// Synthetic, deliberately public test seed. Never use this key for releases.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]),
  format: 'der',
  type: 'pkcs8',
});
const version = '0.8.2';
const asset = (name) => ({
  url: `https://github.com/RavoxX/helious-apps/releases/download/v${version}/Helious_${version}_${name}`,
  sha256: 'a'.repeat(64),
  size: 123,
});
const body =
  JSON.stringify({
    schema: 1,
    version,
    notes: 'Node signer compatibility fixture',
    windows: asset('x64-setup.exe'),
    macos: asset('universal.zip'),
  }) + '\n';
const fixture = {
  body,
  publicKey: createPublicKey(key)
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64'),
  signature: sign(
    null,
    Buffer.concat([Buffer.from('helious-update-v1\n'), Buffer.from(body)]),
    key,
  ).toString('base64'),
};
const directory = new URL('../engine/tests/fixtures/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('node-update.json', directory), JSON.stringify(fixture, null, 2) + '\n');
