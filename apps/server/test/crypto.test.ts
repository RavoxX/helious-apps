import { expect, it } from 'vitest';
import { KeyRing, parsePreviousKeys } from '../src/encryption.js';
import {
  base32,
  fromBase32,
  totpCode,
  totpStep,
  newRecoveryCodes,
  matchingRecovery,
} from '../src/totp.js';
import { canReadSecret, maskSecretReferences, type KnowledgePrincipal } from '@helious/core';
it('authenticates payload, wrapper, key ID and immutable secret context', () => {
  const ring = new KeyRing('v1', 'a'.repeat(64)),
    context = 'secret:owner:vault:space:id';
  const value = Buffer.from('synthetic credential — never real'),
    one = ring.encrypt(value, context),
    two = ring.encrypt(value, context);
  expect(ring.decrypt(one, context)).toEqual(value);
  expect(one.nonce).not.toBe(two.nonce);
  expect(one.wrappedKey.ciphertext).not.toBe(two.wrappedKey.ciphertext);
  for (const altered of [
    { ...one, tag: 'A'.repeat(22) },
    { ...one, ciphertext: one.ciphertext.slice(1) },
    { ...one, keyId: 'missing' },
    { ...one, version: 2 },
    { ...one, wrappedKey: { ...one.wrappedKey, nonce: 'A'.repeat(16) } },
  ])
    expect(() => ring.decrypt(altered as typeof one, context)).toThrow();
  expect(() => ring.decrypt(one, 'secret:other:vault:space:id')).toThrow();
  expect(() => ring.decrypt(one, 'secret:owner:vault:other:id')).toThrow();
});
it('rotates only the wrapped key and validates previous key configuration without disclosing it', () => {
  const old = new KeyRing('v1', 'a'.repeat(64)),
    next = new KeyRing('v2', 'b'.repeat(64), { v1: 'a'.repeat(64) }),
    value = old.encrypt(Buffer.from('test'), 'context');
  const rotated = next.rewrap(value, 'context');
  expect(rotated.ciphertext).toBe(value.ciphertext);
  expect(rotated.nonce).toBe(value.nonce);
  expect(rotated.keyId).toBe('v2');
  expect(new KeyRing('v2', 'b'.repeat(64)).decrypt(rotated, 'context').toString()).toBe('test');
  expect(() => old.decrypt(rotated, 'context')).toThrow();
  expect(() => parsePreviousKeys('{bad-secret-material')).toThrow('JSON object');
  expect(() => new KeyRing('v1', 'a'.repeat(64), { v1: 'b'.repeat(64) })).toThrow();
});
it('matches RFC 6238 SHA-1 vectors and rejects replay outside the 30-second window', () => {
  const secret = Buffer.from('12345678901234567890');
  for (const [time, code] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ] as const)
    expect(totpCode(secret, Math.floor(time / 30), 8)).toBe(code);
  expect(fromBase32(base32(secret))).toEqual(secret);
  const now = 1234567890000,
    step = Math.floor(now / 30000),
    code = totpCode(secret, step);
  expect(totpStep(secret, code, now)).toBe(step);
  expect(totpStep(secret, code, now, step)).toBeNull();
  expect(totpStep(secret, code, now + 90000)).toBeNull();
  expect(totpStep(secret, 'abcdef', now)).toBeNull();
});
it('generates independent recovery codes and compares their hashes', () => {
  const result = newRecoveryCodes();
  expect(result.codes).toHaveLength(10);
  expect(new Set(result.codes).size).toBe(10);
  expect(result.codes.every((code) => Buffer.from(code, 'base64url').length === 16)).toBe(true);
  expect(result.hashes).not.toContain(result.codes[0]);
  expect(matchingRecovery(result.hashes, result.codes[0]!)).toBe(result.hashes[0]);
  expect(matchingRecovery(result.hashes, 'invalid')).toBeNull();
});
it('requires the exact secret grant and both Space and per-secret permission', () => {
  const agent: KnowledgePrincipal = {
    kind: 'agent',
    ownerId: 'owner',
    actorId: 'token',
    vaultIds: ['vault'],
    spaceIds: ['code'],
    scopes: ['secrets:read:key'],
  };
  const space = { id: 'code', ownerId: 'owner', vaultId: 'vault', agentAccess: 'read' as const },
    secret = {
      id: 'key',
      ownerId: 'owner',
      vaultId: 'vault',
      spaceId: 'code',
      agentAccess: 'read' as const,
    };
  expect(canReadSecret(agent, space, secret)).toBe(true);
  expect(canReadSecret({ ...agent, scopes: ['notes:read'] }, space, secret)).toBe(false);
  expect(canReadSecret(agent, { ...space, agentAccess: 'none' }, secret)).toBe(false);
  expect(canReadSecret(agent, space, { ...secret, agentAccess: 'none' })).toBe(false);
  expect(canReadSecret({ ...agent, spaceIds: [] }, space, secret)).toBe(false);
  expect(maskSecretReferences('Use {{secret:prod-ssh}} here')).toBe('Use {{secret:••••••}} here');
});
