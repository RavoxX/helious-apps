import { basename, dirname, normalizeVaultPath, pathKey, resolveRelativePath } from './paths.js';
import { headingSlug, type NoteLink, type ParsedNote } from './markdown.js';

export interface IndexedNote {
  id: string;
  path: string;
  parsed: Pick<ParsedNote, 'title' | 'tags' | 'links' | 'headings' | 'blocks'>;
}
export interface LinkResolution {
  noteId: string | null;
  path: string | null;
  exists: boolean;
  fragmentExists: boolean;
  reason: 'missing' | 'ambiguous' | 'invalid' | null;
}
export function createLinkResolver(notes: IndexedNote[]) {
  const paths = new Map(notes.map((note) => [pathKey(note.path), note]));
  const names = new Map<string, IndexedNote[]>();
  for (const note of notes) {
    const key = pathKey(basename(note.path));
    names.set(key, [...(names.get(key) ?? []), note]);
  }
  return (from: string, link: NoteLink): LinkResolution => {
    const missing = (
      reason: LinkResolution['reason'],
      path: string | null = null,
    ): LinkResolution => ({ noteId: null, path, exists: false, fragmentExists: false, reason });
    let target = link.target || from;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) || target.includes('\\'))
      return missing('invalid');
    if (link.syntax === 'wiki' && !/\.[^/]+$/.test(target)) target += '.md';
    let note: IndexedNote | undefined;
    if (!link.target) note = paths.get(pathKey(from));
    else if (link.syntax === 'wiki' && target.startsWith('/')) {
      try {
        target = normalizeVaultPath(target.slice(1));
      } catch {
        return missing('invalid');
      }
      note = paths.get(pathKey(target));
    } else if (link.syntax === 'markdown' || /^\.{1,2}\//.test(target)) {
      const relative = resolveRelativePath(from, target);
      if (!relative) return missing('invalid');
      note = paths.get(pathKey(relative));
      if (!note) return missing('missing', relative);
    } else {
      try {
        target = normalizeVaultPath(target);
      } catch {
        return missing('invalid');
      }
      const local = dirname(from) ? `${dirname(from)}/${target}` : target;
      note = paths.get(pathKey(local)) ?? paths.get(pathKey(target));
      if (!note && !target.includes('/')) {
        const matches = names.get(pathKey(target)) ?? [];
        if (matches.length > 1) return missing('ambiguous', target);
        note = matches[0];
      }
    }
    if (!note) return missing('missing', target);
    const fragment = link.fragment;
    const fragmentExists =
      !fragment ||
      (fragment.startsWith('^')
        ? note.parsed.blocks.includes(fragment.slice(1))
        : note.parsed.headings.some(
            (heading) =>
              heading.slug === headingSlug(fragment) ||
              heading.text.toLowerCase() === fragment.toLowerCase(),
          ));
    return { noteId: note.id, path: note.path, exists: true, fragmentExists, reason: null };
  };
}

export function buildGraph(notes: IndexedNote[]) {
  const resolve = createLinkResolver(notes);
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const edges = new Map<string, { source: string; target: string; count: number }>();
  const unresolved: Array<{
    source: string;
    target: string;
    reason: LinkResolution['reason'];
    line: number;
  }> = [];
  for (const note of notes)
    for (const link of note.parsed.links) {
      const match = resolve(note.path, link);
      if (!match.noteId) {
        unresolved.push({
          source: note.id,
          target: link.target,
          reason: match.reason,
          line: link.line,
        });
        continue;
      }
      const key = `${note.id}:${match.noteId}`;
      const edge = edges.get(key) ?? { source: note.id, target: match.noteId, count: 0 };
      edge.count++;
      edges.set(key, edge);
      outgoing.set(note.id, (outgoing.get(note.id) ?? new Set()).add(match.noteId));
      incoming.set(match.noteId, (incoming.get(match.noteId) ?? new Set()).add(note.id));
    }
  return {
    nodes: notes.map((note) => ({
      id: note.id,
      path: note.path,
      title: note.parsed.title ?? basename(note.path).replace(/\.md$/i, ''),
      tags: note.parsed.tags,
      incoming: incoming.get(note.id)?.size ?? 0,
      outgoing: outgoing.get(note.id)?.size ?? 0,
    })),
    edges: [...edges.values()],
    unresolved,
  };
}
