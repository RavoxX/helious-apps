import { describe, expect, it } from 'vitest';
import {
  filterKnowledgeGraph,
  graphQuery,
  summarizeKnowledge,
  type KnowledgeGraph,
  type KnowledgeNode,
} from '../src/insights.js';
const node = (id: string, more: Partial<KnowledgeNode> = {}): KnowledgeNode => ({
  id,
  path: `Projects/${id}.md`,
  title: id,
  tags: ['code'],
  incoming: 0,
  outgoing: 0,
  kind: 'note',
  createdAt: '2026-10-28T12:00:00.000Z',
  wordCount: 5,
  ...more,
});
const graph: KnowledgeGraph = {
  nodes: [
    node('A', { outgoing: 1 }),
    node('B', { incoming: 1, outgoing: 1 }),
    node('C', { incoming: 1 }),
    node('orphan', { tags: ['private'] }),
    node('file', { kind: 'attachment' }),
    node('missing', { kind: 'missing' }),
  ],
  edges: [
    { source: 'A', target: 'B', count: 2 },
    { source: 'B', target: 'C', count: 1 },
  ],
  unresolved: [{ source: 'A', target: 'missing', reason: 'missing', line: 1 }],
};
const defaults = {
  query: '',
  attachments: false,
  orphans: true,
  existingOnly: true,
  root: null,
  depth: 1,
};
describe('graph exploration', () => {
  it('combines title/path/tag filters literally and rejects unsupported operators', () => {
    expect(graphQuery('tag:code path:Projects file:A')(node('A'))).toBe(true);
    expect(graphQuery('-tag:code')(node('A'))).toBe(false);
    expect(graphQuery('.*')(node('A'))).toBe(false);
    expect(() => graphQuery('line:2')).toThrow('Unsupported');
  });
  it('filters files, ghosts and orphans without dangling edges', () => {
    expect(filterKnowledgeGraph(graph, defaults).nodes.map((item) => item.id)).toEqual([
      'A',
      'B',
      'C',
      'orphan',
    ]);
    expect(
      filterKnowledgeGraph(graph, { ...defaults, orphans: false }).nodes.map((item) => item.id),
    ).toEqual(['A', 'B', 'C']);
    expect(
      filterKnowledgeGraph(graph, { ...defaults, attachments: true, existingOnly: false }).nodes,
    ).toHaveLength(6);
  });
  it('uses bidirectional depth, stops at filtered nodes and handles cycles and missing roots', () => {
    expect(
      filterKnowledgeGraph(graph, { ...defaults, root: 'A' }).nodes.map((item) => item.id),
    ).toEqual(['A', 'B']);
    expect(
      filterKnowledgeGraph(graph, { ...defaults, root: 'C', depth: 2 }).nodes.map(
        (item) => item.id,
      ),
    ).toEqual(['A', 'B', 'C']);
    expect(
      filterKnowledgeGraph(graph, { ...defaults, root: 'A', query: 'file:C', depth: 5 }).nodes,
    ).toEqual([]);
    expect(
      filterKnowledgeGraph(
        { ...graph, edges: [...graph.edges, { source: 'C', target: 'A', count: 1 }] },
        { ...defaults, root: 'A', depth: 5 },
      ).nodes,
    ).toHaveLength(3);
    expect(filterKnowledgeGraph(graph, { ...defaults, root: 'unknown' }).nodes).toEqual([]);
  });
  it('traverses more than 10,000 nodes and bounds local depth to five', () => {
    const large = {
      nodes: Array.from({ length: 12000 }, (_unused, i) => node(String(i))),
      edges: Array.from({ length: 11999 }, (_unused, i) => ({
        source: String(i),
        target: String(i + 1),
        count: 1,
      })),
      unresolved: [],
    };
    expect(filterKnowledgeGraph(large, { ...defaults, root: '0', depth: 100 }).nodes).toHaveLength(
      6,
    );
    expect(filterKnowledgeGraph(large, defaults).nodes).toHaveLength(12000);
  });
});
describe('vault statistics', () => {
  it('counts real notes and resolved links, deduplicates tags and orders UTC creation growth', () => {
    const data: KnowledgeGraph = {
      ...graph,
      nodes: graph.nodes.map((item) =>
        item.id === 'C'
          ? { ...item, createdAt: '2026-10-29T01:00:00.000Z', tags: ['code', 'code'] }
          : item,
      ),
      edges: [...graph.edges, { source: 'A', target: 'missing', count: 4 }],
    };
    expect(summarizeKnowledge(data)).toMatchObject({
      noteCount: 4,
      words: 20,
      links: 3,
      unresolvedLinks: 1,
      orphans: 1,
      tags: [
        { tag: 'code', count: 3 },
        { tag: 'private', count: 1 },
      ],
      growth: [
        { date: '2026-10-28', added: 3, total: 3 },
        { date: '2026-10-29', added: 1, total: 4 },
      ],
    });
  });
  it('handles a new empty vault without inventing activity', () => {
    expect(summarizeKnowledge({ nodes: [], edges: [], unresolved: [] })).toMatchObject({
      noteCount: 0,
      words: 0,
      links: 0,
      growth: [],
      mostLinked: [],
      tags: [],
    });
  });
});
