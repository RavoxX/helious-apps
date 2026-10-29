import { parseSearchQuery } from './search.js';

export interface KnowledgeNode {
  spaceId?: string;
  id: string;
  path: string;
  title: string;
  tags: string[];
  incoming: number;
  outgoing: number;
  kind: 'note' | 'attachment' | 'missing';
  createdAt: string;
  wordCount: number;
}
export interface KnowledgeEdge {
  source: string;
  target: string;
  count: number;
}
export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  unresolved: { source: string; target: string; reason: string | null; line: number }[];
}
export interface GraphFilter {
  query: string;
  attachments: boolean;
  orphans: boolean;
  existingOnly: boolean;
  root: string | null;
  depth: number;
}
export function graphQuery(query: string) {
  const parsed = parseSearchQuery(query);
  return (node: KnowledgeNode) => {
    const text = `${node.path} ${node.title}`.toLowerCase();
    const file = node.path.split('/').at(-1)!.toLowerCase();
    return (
      parsed.terms.every((term) => text.includes(term.toLowerCase())) &&
      parsed.tags.every((tag) => node.tags.includes(tag)) &&
      parsed.excludedTags.every((tag) => !node.tags.includes(tag)) &&
      parsed.paths.every((path) => node.path.toLowerCase().includes(path.toLowerCase())) &&
      parsed.files.every((part) => file.includes(part.toLowerCase()))
    );
  };
}
/** Local depth traverses the filtered graph in both directions, without crossing hidden nodes. */
export function filterKnowledgeGraph(graph: KnowledgeGraph, options: GraphFilter): KnowledgeGraph {
  const match = graphQuery(options.query);
  let nodes = graph.nodes.filter(
    (node) =>
      match(node) &&
      (options.attachments || node.kind !== 'attachment') &&
      (!options.existingOnly || node.kind !== 'missing') &&
      (options.orphans || node.incoming + node.outgoing > 0),
  );
  let ids = new Set(nodes.map((node) => node.id));
  let edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  if (options.root) {
    const adjacent = new Map<string, string[]>();
    const add = (source: string, target: string) => {
      const list = adjacent.get(source);
      if (list) list.push(target);
      else adjacent.set(source, [target]);
    };
    for (const edge of edges) {
      add(edge.source, edge.target);
      add(edge.target, edge.source);
    }
    const keep = new Set<string>(ids.has(options.root) ? [options.root] : []);
    let frontier = [...keep];
    for (let step = 0; step < Math.max(1, Math.min(5, options.depth)); step++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const neighbor of adjacent.get(id) ?? [])
          if (!keep.has(neighbor)) {
            keep.add(neighbor);
            next.push(neighbor);
          }
      frontier = next;
    }
    nodes = nodes.filter((node) => keep.has(node.id));
    ids = keep;
    edges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  }
  return { nodes, edges, unresolved: graph.unresolved.filter((link) => ids.has(link.source)) };
}
export function summarizeKnowledge(graph: KnowledgeGraph) {
  const notes = graph.nodes.filter((node) => node.kind === 'note');
  const tags = new Map<string, number>();
  const dates = new Map<string, number>();
  for (const note of notes) {
    for (const tag of new Set(note.tags)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const day = note.createdAt.slice(0, 10);
    dates.set(day, (dates.get(day) ?? 0) + 1);
  }
  let cumulative = 0;
  const missing = new Set(
    graph.nodes.filter((node) => node.kind === 'missing').map((node) => node.id),
  );
  return {
    noteCount: notes.length,
    words: notes.reduce((sum, note) => sum + note.wordCount, 0),
    links: graph.edges.reduce((sum, edge) => sum + (missing.has(edge.target) ? 0 : edge.count), 0),
    unresolvedLinks: graph.unresolved.length,
    orphans: notes.filter((note) => note.incoming + note.outgoing === 0).length,
    tags: [...tags]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    mostLinked: [...notes]
      .sort((a, b) => b.incoming - a.incoming || a.path.localeCompare(b.path))
      .slice(0, 10)
      .map(({ id, path, incoming }) => ({ id, path, incoming })),
    growth: [...dates]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, added]) => ({ date, added, total: (cumulative += added) })),
  };
}
export type KnowledgeSummary = ReturnType<typeof summarizeKnowledge>;
