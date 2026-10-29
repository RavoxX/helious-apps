import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
} from 'd3-force';
import { api } from './api';
interface Graph {
  nodes: { id: string; title: string; kind: string }[];
  edges: { source: string; target: string }[];
}
interface Point extends SimulationNodeDatum {
  id: string;
  title: string;
}
export function LocalConnections({
  vaultId,
  noteId,
  spaceId,
  open,
}: {
  vaultId: string;
  noteId: string;
  spaceId: string;
  open: () => void;
}) {
  const query = useQuery({
    queryKey: ['local-preview', vaultId, spaceId],
    queryFn: () => api<Graph>(`/vaults/${vaultId}/graph?spaceId=${spaceId}`),
    staleTime: 15000,
  });
  const layout = useMemo(() => {
    if (!query.data) return null;
    const graph = query.data,
      ids = new Set([noteId]);
    let frontier = [noteId];
    for (let depth = 0; depth < 2; depth++) {
      const next: string[] = [];
      for (const edge of graph.edges) {
        const other = frontier.includes(edge.source)
          ? edge.target
          : frontier.includes(edge.target)
            ? edge.source
            : null;
        if (other && !ids.has(other) && ids.size < 32) {
          ids.add(other);
          next.push(other);
        }
      }
      frontier = next;
    }
    const points: Point[] = graph.nodes
      .filter((node) => node.kind === 'note' && ids.has(node.id))
      .map((node) => ({
        id: node.id,
        title: node.title,
        ...(node.id === noteId ? { fx: 0, fy: 0 } : {}),
      }));
    const actual = new Set(points.map((point) => point.id)),
      links = graph.edges
        .filter((edge) => actual.has(edge.source) && actual.has(edge.target))
        .map((edge) => ({ ...edge }));
    const simulation = forceSimulation(points)
      .force(
        'link',
        forceLink<Point, { source: string | Point; target: string | Point }>(links)
          .id((node) => node.id)
          .distance(28),
      )
      .force('charge', forceManyBody().strength(-90))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide(8))
      .stop();
    simulation.tick(100);
    const lookup = new Map(points.map((point) => [point.id, point]));
    const extent = Math.max(
      60,
      ...points.flatMap((point) => [Math.abs(point.x ?? 0), Math.abs(point.y ?? 0)]),
    );
    return {
      points,
      links: graph.edges.filter((edge) => actual.has(edge.source) && actual.has(edge.target)),
      lookup,
      extent,
    };
  }, [query.data, noteId]);
  return (
    <section className="local-connections-preview">
      <h3>Local connections</h3>
      {query.error ? (
        <p>Graph preview unavailable.</p>
      ) : query.isPending ? (
        <p role="status">Finding nearby notes…</p>
      ) : (
        layout && (
          <button onClick={open} aria-label="Explore nearby notes in graph">
            <svg
              viewBox={`${-layout.extent - 12} ${-layout.extent - 12} ${layout.extent * 2 + 24} ${layout.extent * 2 + 24}`}
              role="img"
              aria-label={`${layout.points.length} nearby notes in this Space`}
            >
              {layout.links.map((edge, index) => (
                <line
                  key={index}
                  x1={layout.lookup.get(edge.source)?.x ?? 0}
                  y1={layout.lookup.get(edge.source)?.y ?? 0}
                  x2={layout.lookup.get(edge.target)?.x ?? 0}
                  y2={layout.lookup.get(edge.target)?.y ?? 0}
                />
              ))}
              {layout.points.map((point) => (
                <circle
                  key={point.id}
                  cx={point.x ?? 0}
                  cy={point.y ?? 0}
                  r={point.id === noteId ? 4 : 2.4}
                  className={point.id === noteId ? 'current' : ''}
                >
                  <title>{point.title}</title>
                </circle>
              ))}
            </svg>
            <span>
              {layout.points.length > 1
                ? 'Follow a connection'
                : 'Link this note to start a connection'}
            </span>
          </button>
        )
      )}
    </section>
  );
}
