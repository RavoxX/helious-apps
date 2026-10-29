import { normalizeVaultPath, pathKey } from './paths.js';

/** A content fingerprint also includes the selected remote Space. Credentials never belong here. */
export interface SyncFile {
  path: string;
  hash: string;
  spaceId: string;
  kind: 'note' | 'attachment';
  id?: string;
  revision?: number;
}
export interface SyncBase {
  local: SyncFile | null;
  remote: SyncFile | null;
  conflict?: boolean;
}
export type SyncAction = {
  path: string;
  local: SyncFile | null;
  remote: SyncFile | null;
  action: 'equal' | 'push' | 'pull' | 'conflict' | 'unresolved';
};
export const sameSyncFile = (a: SyncFile | null, b: SyncFile | null) =>
  a === null || b === null
    ? a === b
    : a.path === b.path && a.hash === b.hash && a.spaceId === b.spaceId && a.kind === b.kind;
function index(files: SyncFile[]) {
  const result = new Map<string, SyncFile>();
  for (const file of files) {
    normalizeVaultPath(file.path);
    if (!/^[a-f0-9]{64}$/.test(file.hash)) throw new Error('Invalid sync content hash');
    const key = pathKey(file.path);
    if (result.has(key))
      throw new Error('Sync cannot choose between paths that differ only by case');
    result.set(key, file);
  }
  return result;
}
/** Three-way comparison. A missing file is a deletion only after a shared checkpoint exists. */
export function planSync(
  localFiles: SyncFile[],
  remoteFiles: SyncFile[],
  base: Record<string, SyncBase>,
): SyncAction[] {
  const local = index(localFiles),
    remote = index(remoteFiles);
  return [...new Set([...local.keys(), ...remote.keys(), ...Object.keys(base)])]
    .sort()
    .map((key) => {
      const l = local.get(key) ?? null,
        r = remote.get(key) ?? null,
        b = base[key];
      const action = sameSyncFile(l, r)
        ? 'equal'
        : b?.conflict
          ? 'unresolved'
          : !b
            ? !l
              ? 'pull'
              : !r
                ? 'push'
                : 'conflict'
            : sameSyncFile(l, b.local)
              ? 'pull'
              : sameSyncFile(r, b.remote)
                ? 'push'
                : 'conflict';
      return {
        path: l?.path ?? r?.path ?? b?.local?.path ?? b?.remote?.path ?? key,
        local: l,
        remote: r,
        action,
      };
    });
}
export function conflictPath(path: string, side: 'local' | 'server', stamp: string, nonce: string) {
  normalizeVaultPath(path);
  if (!/^\d{8}T\d{6}Z$/.test(stamp) || !/^[a-f0-9]{8}$/.test(nonce))
    throw new Error('Invalid conflict suffix');
  const dot = path.lastIndexOf('.'),
    slash = path.lastIndexOf('/');
  const split = dot > slash ? dot : path.length;
  return normalizeVaultPath(
    `${path.slice(0, split)}.conflict-${stamp}-${side}-${nonce}${path.slice(split)}`,
  );
}
export const isConflictPath = (path: string) =>
  /\.conflict-\d{8}T\d{6}Z-(?:local|server)-[a-f0-9]{8}(?:\.|$)/.test(path);
