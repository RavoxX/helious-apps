import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export interface Ciphertext {
  nonce: string;
  ciphertext: string;
  tag: string;
}
export interface Envelope extends Ciphertext {
  version: 1;
  keyId: string;
  wrappedKey: Ciphertext;
}
const invalid = () =>
  new Error('Encrypted data could not be opened. Check the configured key ring and stored data.');
const encode = (value: Buffer) => value.toString('base64url');
function decode(value: string, length?: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (length !== undefined && bytes.length !== length))
    throw invalid();
  return bytes;
}
function seal(value: Buffer, key: Buffer, aad: string): Ciphertext {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad));
  return {
    nonce: encode(nonce),
    ciphertext: encode(Buffer.concat([cipher.update(value), cipher.final()])),
    tag: encode(cipher.getAuthTag()),
  };
}
function open(value: Ciphertext, key: Buffer, aad: string) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, decode(value.nonce, 12), {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(decode(value.tag, 16));
    return Buffer.concat([decipher.update(decode(value.ciphertext)), decipher.final()]);
  } catch {
    throw invalid();
  }
}
export class KeyRing {
  private readonly keys: Map<string, Buffer>;
  constructor(
    readonly activeId: string,
    activeKey: string,
    previous: Record<string, string> = {},
  ) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(activeId) || !/^[a-f\d]{64}$/i.test(activeKey))
      throw new Error('Invalid encryption key configuration');
    this.keys = new Map([[activeId, Buffer.from(activeKey, 'hex')]]);
    for (const [id, key] of Object.entries(previous)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || id === activeId || !/^[a-f\d]{64}$/i.test(key))
        throw new Error('Invalid previous encryption key configuration');
      this.keys.set(id, Buffer.from(key, 'hex'));
    }
  }
  has(id: string) {
    return this.keys.has(id);
  }
  encrypt(value: Buffer, context: string): Envelope {
    const key = randomBytes(32);
    try {
      return {
        version: 1,
        keyId: this.activeId,
        ...seal(value, key, `helious:data:v1:${context}`),
        wrappedKey: seal(
          key,
          this.keys.get(this.activeId)!,
          `helious:key:v1:${this.activeId}:${context}`,
        ),
      };
    } finally {
      key.fill(0);
    }
  }
  private unwrap(value: Envelope, context: string) {
    if (!value || value.version !== 1 || !this.keys.has(value.keyId)) throw invalid();
    const key = open(
      value.wrappedKey,
      this.keys.get(value.keyId)!,
      `helious:key:v1:${value.keyId}:${context}`,
    );
    if (key.length !== 32) {
      key.fill(0);
      throw invalid();
    }
    return key;
  }
  decrypt(value: Envelope, context: string) {
    const key = this.unwrap(value, context);
    try {
      return open(value, key, `helious:data:v1:${context}`);
    } finally {
      key.fill(0);
    }
  }
  rewrap(value: Envelope, context: string): Envelope {
    const key = this.unwrap(value, context);
    try {
      return {
        ...value,
        keyId: this.activeId,
        wrappedKey: seal(
          key,
          this.keys.get(this.activeId)!,
          `helious:key:v1:${this.activeId}:${context}`,
        ),
      };
    } finally {
      key.fill(0);
    }
  }
}
export function parsePreviousKeys(input: string) {
  if (!input.trim()) return {} as Record<string, string>;
  try {
    const object: unknown = JSON.parse(input);
    if (
      !object ||
      typeof object !== 'object' ||
      Array.isArray(object) ||
      Object.keys(object).length > 10
    )
      throw new Error();
    for (const [id, key] of Object.entries(object))
      if (
        !/^[A-Za-z0-9_-]{1,40}$/.test(id) ||
        typeof key !== 'string' ||
        !/^[a-f\d]{64}$/i.test(key)
      )
        throw new Error();
    return object as Record<string, string>;
  } catch {
    throw new Error(
      'HELIOUS_PREVIOUS_MASTER_KEYS must be a JSON object of key IDs to 64 hexadecimal characters (up to 10 keys)',
    );
  }
}
