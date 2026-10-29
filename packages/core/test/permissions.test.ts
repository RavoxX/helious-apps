import { expect, it } from 'vitest';
import { canAccessSpace, type KnowledgePrincipal, type SpacePolicy } from '../src/permissions.js';
const personal: SpacePolicy = {
  id: 'personal',
  vaultId: 'vault',
  ownerId: 'owner',
  agentAccess: 'none',
};
const code: SpacePolicy = { ...personal, id: 'code', agentAccess: 'read-write' };
const agent: Extract<KnowledgePrincipal, { kind: 'agent' }> = {
  kind: 'agent',
  ownerId: 'owner',
  actorId: 'token-id',
  vaultIds: ['vault'],
  spaceIds: ['code'],
  scopes: ['notes:read', 'notes:write'],
};
it('allows the owner and rejects every cross-account principal', () => {
  expect(
    canAccessSpace({ kind: 'user', ownerId: 'owner', actorId: 'owner' }, personal, 'write'),
  ).toBe(true);
  expect(canAccessSpace({ kind: 'user', ownerId: 'other', actorId: 'other' }, code, 'read')).toBe(
    false,
  );
  expect(canAccessSpace({ kind: 'user', ownerId: 'owner', actorId: 'other' }, code, 'read')).toBe(
    false,
  );
  expect(canAccessSpace({ ...agent, ownerId: 'other' }, code, 'read')).toBe(false);
});
it('requires an explicit vault, space and operation grant and keeps Personal default-deny', () => {
  expect(canAccessSpace(agent, code, 'write')).toBe(true);
  for (const input of [
    { ...agent, spaceIds: [] },
    { ...agent, vaultIds: [] },
    { ...agent, scopes: [] },
  ])
    expect(canAccessSpace(input, code, 'read')).toBe(false);
  expect(canAccessSpace({ ...agent, spaceIds: ['code', 'personal'] }, personal, 'read')).toBe(
    false,
  );
  expect(canAccessSpace(agent, { ...personal, agentAccess: 'read-write' }, 'read')).toBe(false);
  expect(
    canAccessSpace(
      { ...agent, spaceIds: ['personal'] },
      { ...personal, agentAccess: 'read' },
      'read',
    ),
  ).toBe(true);
});
it('intersects token scopes with the current space policy, including revocation', () => {
  expect(canAccessSpace({ ...agent, scopes: ['notes:read'] }, code, 'write')).toBe(false);
  expect(canAccessSpace({ ...agent, scopes: ['notes:write'] }, code, 'write')).toBe(false);
  expect(canAccessSpace(agent, { ...code, agentAccess: 'read' }, 'read')).toBe(true);
  expect(canAccessSpace(agent, { ...code, agentAccess: 'read' }, 'write')).toBe(false);
  expect(canAccessSpace(agent, { ...code, agentAccess: 'none' }, 'read')).toBe(false);
});
