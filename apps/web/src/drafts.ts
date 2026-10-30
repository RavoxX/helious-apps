import type { SyncFile } from '@helious/core';
interface Draft {
  spaceId?: string;
  path: string;
  markdown: string;
  revision: number;
}
const drafts = new Map<string, Draft>();
const canvasDrafts = new Map<
  string,
  { source: string; expected: SyncFile & { id: string; revision: number } }
>();
const key = (vaultId: string, noteId: string) => `${vaultId}:${noteId}`;
const warn = (event: BeforeUnloadEvent) => {
  event.preventDefault();
};
let guarding = false;
function guard() {
  if ((drafts.size || canvasDrafts.size) && !guarding) {
    window.addEventListener('beforeunload', warn);
    guarding = true;
  } else if (!drafts.size && !canvasDrafts.size && guarding) {
    window.removeEventListener('beforeunload', warn);
    guarding = false;
  }
}
export const getDraft = (vaultId: string, noteId: string) => drafts.get(key(vaultId, noteId));
export const hasDrafts = () => drafts.size > 0 || canvasDrafts.size > 0;
export const getCanvasDraft = (vaultId: string, id: string) => canvasDrafts.get(key(vaultId, id));
export function keepCanvasDraft(
  vaultId: string,
  id: string,
  draft: { source: string; expected: SyncFile & { id: string; revision: number } },
) {
  canvasDrafts.set(key(vaultId, id), draft);
  guard();
}
export function discardCanvasDraft(vaultId: string, id: string) {
  canvasDrafts.delete(key(vaultId, id));
  guard();
}
export function keepDraft(vaultId: string, noteId: string, draft: Draft) {
  drafts.set(key(vaultId, noteId), draft);
  guard();
}
export function discardDraft(vaultId: string, noteId: string) {
  drafts.delete(key(vaultId, noteId));
  guard();
}
export function discardAllDrafts() {
  drafts.clear();
  canvasDrafts.clear();
  guard();
}
