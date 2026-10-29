import { createLinkResolver, type IndexedNote } from './graph.js';
import { dirname, normalizeNotePath, pathKey, resolveRelativePath } from './paths.js';

export interface MoveNote extends IndexedNote {
  markdown: string;
}
const relative = (from: string, target: string) => {
  const parts = dirname(from).split('/').filter(Boolean);
  const destination = target.split('/');
  while (parts.length && destination.length && parts[0] === destination[0]) {
    parts.shift();
    destination.shift();
  }
  return [...parts.map(() => '..'), ...destination]
    .map((part) => (part === '..' ? part : encodeURIComponent(part)))
    .join('/');
};
/** Rewrites only parsed destination spans, preserving labels, fragments, code and formatting. */
export function planNoteMove(notes: MoveNote[], id: string, path: string) {
  const newPath = normalizeNotePath(path);
  const source = notes.find((note) => note.id === id);
  if (!source) throw new Error('Note not found');
  if (notes.some((note) => note.id !== id && pathKey(note.path) === pathKey(newPath)))
    throw new Error('A note already exists at this path');
  const before = createLinkResolver(notes);
  const after = createLinkResolver(
    notes.map((note) => (note.id === id ? { ...note, path: newPath } : note)),
  );
  return notes.flatMap((note) => {
    const from = note.id === id ? newPath : note.path;
    const edits = new Map<number, { end: number; value: string }>();
    for (const link of note.parsed.links) {
      if (!link.target || link.targetStart === undefined || link.targetEnd === undefined) continue;
      const resolved = before(note.path, link);
      const target = resolved.noteId === id ? newPath : resolved.path;
      const changed =
        resolved.noteId && (resolved.noteId === id || after(from, link).noteId !== resolved.noteId);
      if (changed && target)
        edits.set(link.targetStart, {
          end: link.targetEnd,
          value: link.syntax === 'wiki' ? `/${target}` : relative(from, target),
        });
      else if (from !== note.path && link.syntax === 'markdown') {
        const destination = resolveRelativePath(note.path, link.target);
        if (destination)
          edits.set(link.targetStart, { end: link.targetEnd, value: relative(from, destination) });
      }
    }
    let markdown = note.markdown;
    for (const [start, edit] of [...edits.entries()].sort(([a], [b]) => b - a))
      markdown = markdown.slice(0, start) + edit.value + markdown.slice(edit.end);
    return from !== note.path || markdown !== note.markdown
      ? [{ id: note.id, path: from, markdown, rewrites: edits.size }]
      : [];
  });
}
