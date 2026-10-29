import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Buffer) {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
export function fromBase32(value: string) {
  if (!/^[A-Z2-7]+$/.test(value)) throw new Error('Invalid authenticator key');
  let bits = 0,
    input = 0;
  const bytes: number[] = [];
  for (const char of value) {
    input = (input << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((input >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function totpCode(secret: Buffer, step: number, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, '0');
}
export function totpStep(secret: Buffer, code: string, now = Date.now(), lastStep = -1) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  let matched: number | null = null;
  for (const offset of [-1, 0, 1]) {
    const step = current + offset;
    if (step < 0) continue;
    const equal = timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code));
    if (equal && step > lastStep) matched = step;
  }
  return matched;
}
export const recoveryHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString('base64url'));
  return { codes, hashes: codes.map(recoveryHash) };
}
export function matchingRecovery(hashes: string[], value: string) {
  if (value.length > 128) return null;
  const candidate = recoveryHash(value);
  let match: string | null = null;
  for (const hash of hashes)
    if (
      /^[a-f\d]{64}$/.test(hash) &&
      timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'))
    )
      match = hash;
  return match;
}
