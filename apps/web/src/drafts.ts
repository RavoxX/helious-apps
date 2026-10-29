interface Draft {
  spaceId?: string;
  path: string;
  markdown: string;
  revision: number;
}
const drafts = new Map<string, Draft>();
const key = (vaultId: string, noteId: string) => `${vaultId}:${noteId}`;
const warn = (event: BeforeUnloadEvent) => {
  event.preventDefault();
};
let guarding = false;
function guard() {
  if (drafts.size && !guarding) {
    window.addEventListener('beforeunload', warn);
    guarding = true;
  } else if (!drafts.size && guarding) {
    window.removeEventListener('beforeunload', warn);
    guarding = false;
  }
}
export const getDraft = (vaultId: string, noteId: string) => drafts.get(key(vaultId, noteId));
export const hasDrafts = () => drafts.size > 0;
export function keepDraft(vaultId: string, noteId: string, draft: Draft) {
  drafts.set(key(vaultId, noteId), draft);
  guard();
}
export function discardDraft(vaultId: string, noteId: string) {
  drafts.delete(key(vaultId, noteId));
  guard();
}
