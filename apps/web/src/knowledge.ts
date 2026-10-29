import type { QueryClient } from '@tanstack/react-query';
export interface Space {
  id: string;
  name: string;
  kind: 'personal' | 'code' | 'custom';
  agentAccess: 'none' | 'read' | 'read-write';
  revision: number;
}
export function refreshVault(client: QueryClient, vaultId: string) {
  return Promise.all(
    [
      'notes',
      'note',
      'links',
      'graph',
      'local-preview',
      'analytics',
      'history',
      'version',
      'deleted-notes',
      'attachments',
    ].map((key) => client.invalidateQueries({ queryKey: [key, vaultId] })),
  );
}
export const spaceQuery = (spaceId: string) =>
  spaceId ? `spaceId=${encodeURIComponent(spaceId)}` : '';
