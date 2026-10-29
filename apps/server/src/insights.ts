import { BSON, ObjectId, type Db, type ClientSession } from 'mongodb';
import {
  buildGraph,
  createLinkResolver,
  resolveRelativePath,
  basename,
  dirname,
  normalizeVaultPath,
  type KnowledgeGraph,
  type IndexedNote,
} from '@helious/core';
import { vaultCollections, type NoteDocument, type AttachmentDocument } from './vault-db.js';

export const GRAPH_NODE_LIMIT = 50000;
const METADATA_LIMIT = 64 * 1024 * 1024;
type GraphNote = Pick<
  NoteDocument,
  '_id' | 'path' | 'createdAt' | 'updatedAt' | 'spaceId' | 'deleted'
> & {
  parsed: IndexedNote['parsed'] & { wordCount: number };
};
type GraphFile = Pick<AttachmentDocument, '_id' | 'path' | 'createdAt' | 'spaceId'>;
const limitError = () =>
  Object.assign(
    new Error(
      'Graph and analytics support up to 50,000 nodes, 200,000 local link occurrences and 64 MiB of projected metadata per vault.',
    ),
    { statusCode: 422 },
  );
export async function indexedVaultNotes(
  db: Db,
  ownerId: ObjectId,
  vaultId: ObjectId,
  includeDeleted = false,
) {
  const notes: GraphNote[] = [];
  let links = 0;
  let bytes = 0;
  for await (const note of vaultCollections(db).notes.find<GraphNote>(
    { ownerId, vaultId, ...(!includeDeleted ? { deleted: { $ne: true } } : {}) },
    {
      projection: {
        path: 1,
        spaceId: 1,
        deleted: 1,
        createdAt: 1,
        updatedAt: 1,
        'parsed.title': 1,
        'parsed.tags': 1,
        'parsed.links': 1,
        'parsed.headings': 1,
        'parsed.blocks': 1,
        'parsed.wordCount': 1,
      },
    },
  )) {
    links += note.parsed.links.length;
    bytes += BSON.calculateObjectSize(note);
    if (notes.length >= GRAPH_NODE_LIMIT || links > 200000 || bytes > METADATA_LIMIT)
      throw limitError();
    notes.push(note);
  }
  return notes;
}
export async function vaultKnowledgeGraph(
  db: Db,
  ownerId: ObjectId,
  vaultId: ObjectId,
): Promise<
  KnowledgeGraph & {
    linkTargets: { source: string; line: number; target: string; targetId: string }[];
  }
> {
  const notes = await indexedVaultNotes(db, ownerId, vaultId);
  const indexed: IndexedNote[] = notes.map((note) => ({
    id: note._id.toHexString(),
    path: note.path,
    parsed: note.parsed,
  }));
  const base = buildGraph(indexed);
  const resolve = createLinkResolver(indexed);
  const dates = new Map(notes.map((note) => [note._id.toHexString(), note]));
  const personal = await vaultCollections(db).spaces.findOne({ ownerId, vaultId, key: 'personal' });
  const graph: KnowledgeGraph & {
    linkTargets: { source: string; line: number; target: string; targetId: string }[];
  } = {
    ...base,
    linkTargets: [],
    nodes: base.nodes.map((node) => ({
      ...node,
      spaceId: (dates.get(node.id)!.spaceId ?? personal?._id)?.toHexString(),
      kind: 'note',
      createdAt: dates.get(node.id)!.createdAt.toISOString(),
      wordCount: dates.get(node.id)!.parsed.wordCount,
    })),
  };
  const files: GraphFile[] = [];
  let bytes = notes.reduce((sum, note) => sum + BSON.calculateObjectSize(note), 0);
  for await (const file of vaultCollections(db).attachments.find<GraphFile>(
    { ownerId, vaultId, state: 'ready' },
    { projection: { path: 1, createdAt: 1, spaceId: 1 } },
  )) {
    bytes += BSON.calculateObjectSize(file);
    if (graph.nodes.length + files.length >= GRAPH_NODE_LIMIT || bytes > METADATA_LIMIT)
      throw limitError();
    files.push(file);
  }
  const attachments = new Map(
    files.map((file) => [file.path.normalize('NFC').toLowerCase(), file]),
  );
  const fileNames = new Map<string, (typeof files)[number] | null>();
  for (const file of files) {
    const name = basename(file.path).normalize('NFC').toLowerCase();
    fileNames.set(name, fileNames.has(name) ? null : file);
  }
  for (const file of files)
    graph.nodes.push({
      id: `attachment:${file._id}`,
      spaceId: (file.spaceId ?? personal?._id)?.toHexString(),
      path: file.path,
      title: basename(file.path),
      tags: [],
      incoming: 0,
      outgoing: 0,
      kind: 'attachment',
      createdAt: file.createdAt.toISOString(),
      wordCount: 0,
    });
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [`${edge.source}:${edge.target}`, edge]));
  const unresolved: KnowledgeGraph['unresolved'] = [];
  for (const note of indexed)
    for (const link of note.parsed.links) {
      const resolution = resolve(note.path, link);
      if (resolution.noteId) {
        graph.linkTargets.push({
          source: note.id,
          line: link.line,
          target: link.target,
          targetId: resolution.noteId,
        });
        continue;
      }
      const destination =
        link.syntax === 'markdown' || /^\.{1,2}\//.test(link.target)
          ? resolveRelativePath(note.path, link.target)
          : link.target.replace(/^\//, '');
      let file = destination
        ? attachments.get(destination.normalize('NFC').toLowerCase())
        : undefined;
      if (
        link.syntax === 'wiki' &&
        resolution.reason !== 'invalid' &&
        !/^\.{1,2}\//.test(link.target) &&
        !link.target.startsWith('/')
      ) {
        try {
          const path = normalizeVaultPath(link.target).toLowerCase();
          const local = dirname(note.path) ? `${dirname(note.path).toLowerCase()}/${path}` : path;
          file =
            attachments.get(local) ??
            attachments.get(path) ??
            (!path.includes('/') ? (fileNames.get(path) ?? undefined) : undefined);
        } catch {
          /* Invalid references remain unresolved. */
        }
      }
      let target: string;
      if (file) target = `attachment:${file._id}`;
      else {
        unresolved.push({
          source: note.id,
          target: link.target,
          reason: resolution.reason,
          line: link.line,
        });
        target = `missing:${resolution.path ?? `${note.path}:${link.target}`}`;
        if (!nodes.has(target)) {
          if (nodes.size >= GRAPH_NODE_LIMIT) throw limitError();
          const node = {
            id: target,
            path: resolution.path ?? link.target,
            title: link.target || 'Unresolved link',
            tags: [],
            incoming: 0,
            outgoing: 0,
            kind: 'missing' as const,
            createdAt: dates.get(note.id)!.createdAt.toISOString(),
            wordCount: 0,
          };
          bytes += BSON.calculateObjectSize(node);
          if (bytes > METADATA_LIMIT) throw limitError();
          graph.nodes.push(node);
          nodes.set(target, node);
        } else if (nodes.get(target)!.kind === 'missing') {
          const ghost = nodes.get(target)!;
          const date = dates.get(note.id)!.createdAt.toISOString();
          if (date < ghost.createdAt) ghost.createdAt = date;
        }
      }
      graph.linkTargets.push({
        source: note.id,
        line: link.line,
        target: link.target,
        targetId: target,
      });
      const key = `${note.id}:${target}`;
      const edge = edges.get(key);
      if (edge) edge.count++;
      else {
        edges.set(key, { source: note.id, target, count: 1 });
        nodes.get(note.id)!.outgoing++;
        nodes.get(target)!.incoming++;
      }
    }
  graph.edges = [...edges.values()];
  graph.unresolved = unresolved;
  return graph;
}
export async function recordNoteChange(
  db: Db,
  ownerId: ObjectId,
  vaultId: ObjectId,
  noteId: ObjectId,
  action: 'create' | 'update' | 'move' | 'delete' | 'restore',
  session: ClientSession,
  spaceId?: ObjectId,
) {
  await db
    .collection('note_changes')
    .insertOne({ ownerId, vaultId, noteId, spaceId, action, at: new Date() }, { session });
}
