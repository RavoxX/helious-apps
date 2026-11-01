/** Principals are produced by trusted authentication code, never from request headers or bodies. */
export type KnowledgePrincipal =
  | { kind: 'user'; ownerId: string; actorId: string }
  | {
      kind: 'agent';
      ownerId: string;
      actorId: string;
      vaultIds: string[];
      spaceIds: string[];
      scopes: ('notes:read' | 'notes:write' | 'secrets:create' | `secrets:read:${string}`)[];
    };
export interface SpacePolicy {
  id: string;
  vaultId: string;
  ownerId: string;
  agentAccess: 'none' | 'read' | 'read-write';
}
export function canAccessSpace(
  principal: KnowledgePrincipal,
  space: SpacePolicy,
  operation: 'read' | 'write',
) {
  if (principal.ownerId !== space.ownerId) return false;
  if (principal.kind === 'user') return principal.actorId === principal.ownerId;
  return (
    principal.vaultIds.includes(space.vaultId) &&
    principal.spaceIds.includes(space.id) &&
    principal.scopes.includes('notes:read') &&
    (operation === 'read' || principal.scopes.includes('notes:write')) &&
    space.agentAccess !== 'none' &&
    (operation === 'read' || space.agentAccess === 'read-write')
  );
}

export interface SecretPolicy {
  id: string;
  ownerId: string;
  vaultId: string;
  spaceId: string;
  agentAccess: 'none' | 'read';
}
/** Creation is write-only; it never grants access to any stored secret value. */
export function canCreateSecret(principal: KnowledgePrincipal, space: SpacePolicy) {
  if (principal.ownerId !== space.ownerId) return false;
  if (principal.kind === 'user') return principal.actorId === principal.ownerId;
  return (
    principal.vaultIds.includes(space.vaultId) &&
    principal.spaceIds.includes(space.id) &&
    principal.scopes.includes('secrets:create') &&
    space.agentAccess === 'read-write'
  );
}
export function canReadSecret(
  principal: KnowledgePrincipal,
  space: SpacePolicy,
  secret: SecretPolicy,
) {
  if (
    principal.ownerId !== secret.ownerId ||
    space.ownerId !== secret.ownerId ||
    space.vaultId !== secret.vaultId ||
    space.id !== secret.spaceId
  )
    return false;
  if (principal.kind === 'user') return principal.actorId === principal.ownerId;
  return (
    secret.agentAccess === 'read' &&
    space.agentAccess !== 'none' &&
    principal.vaultIds.includes(secret.vaultId) &&
    principal.spaceIds.includes(secret.spaceId) &&
    principal.scopes.includes(`secrets:read:${secret.id}`)
  );
}
/** References are deliberately never resolved to stored values. Source retains the literal token. */
export const maskSecretReferences = (value: string) =>
  value.replace(/\{\{secret:[^}\r\n]{1,160}\}\}/g, '{{secret:••••••}}');
