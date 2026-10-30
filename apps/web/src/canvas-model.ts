import type { CanvasDocument } from '@helious/core';
export type NoteLink = { id: string; path: string };
export const serialize = (doc: CanvasDocument) => JSON.stringify(doc, null, 2);
const palette = ['', '#dc6666', '#d49848', '#bfaa39', '#529c75', '#4c9bad', '#9475c5'];
export const tint = (color?: string) =>
  color?.startsWith('#') ? color : palette[Number(color)] || 'var(--color-muted)';

export function download(path: string, source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = path.split('/').at(-1)!;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
