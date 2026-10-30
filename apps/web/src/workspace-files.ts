import type { SyncFile } from '@helious/core';
import { api } from './api';

export type WorkspaceFile = SyncFile & { id: string; revision: number };
export async function readWorkspaceFile(vaultId: string, id: string) {
  const result = await api<{ file: WorkspaceFile; data: string }>(
    `/vaults/${vaultId}/sync/file?id=${encodeURIComponent(id)}&kind=attachment`,
  );
  const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0));
  return { file: result.file, source: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
}
export async function saveWorkspaceFile(
  vaultId: string,
  path: string,
  spaceId: string,
  source: string | null,
  expected: WorkspaceFile | null,
) {
  const bytes = source === null ? null : new TextEncoder().encode(source);
  let binary = '';
  if (bytes)
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return api<{ file: WorkspaceFile }>(`/vaults/${vaultId}/sync/file`, 'POST', {
    path,
    spaceId,
    kind: 'attachment',
    expected,
    data: bytes === null ? null : btoa(binary),
  });
}
