import { graphQuery } from '@helious/core';
import { defaultForces, defaultDisplay, type GraphDisplay } from './graph-layout-types';
export interface ColorGroup {
  query: string;
  color: string;
}
export function graphPreferences(key: string) {
  const fallback = {
    forces: { ...defaultForces },
    display: { ...defaultDisplay },
    groups: [] as ColorGroup[],
    grouping: 'folder' as 'folder' | 'tag' | 'none',
  };
  try {
    const record = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const raw = record(JSON.parse(localStorage.getItem(key) ?? 'null') as unknown);
    const force = record(raw.forces);
    const display = record(raw.display);
    const range = (value: unknown, min: number, max: number, initial: number) =>
      typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
        ? value
        : initial;
    const groups = Array.isArray(raw.groups)
      ? raw.groups.slice(0, 12).filter((group: unknown): group is ColorGroup => {
          if (
            !group ||
            typeof group !== 'object' ||
            !('query' in group) ||
            !('color' in group) ||
            typeof group.query !== 'string' ||
            !group.query.trim() ||
            typeof group.color !== 'string' ||
            !/^#[0-9a-f]{6}$/i.test(group.color)
          )
            return false;
          try {
            graphQuery(group.query);
            return true;
          } catch {
            return false;
          }
        })
      : [];
    return {
      groups,
      grouping:
        typeof raw.grouping === 'string' && ['folder', 'tag', 'none'].includes(raw.grouping)
          ? (raw.grouping as typeof fallback.grouping)
          : fallback.grouping,
      forces: {
        center: range(force.center, 0, 40, defaultForces.center),
        repel: range(force.repel, 10, 800, defaultForces.repel),
        link: range(force.link, 0.01, 1, defaultForces.link),
        distance: range(force.distance, 10, 200, defaultForces.distance),
      },
      display: {
        nodeSize: range(display.nodeSize, 0.5, 3, defaultDisplay.nodeSize),
        edgeSize: range(display.edgeSize, 0.2, 3, defaultDisplay.edgeSize),
        arrows: typeof display.arrows === 'boolean' ? display.arrows : false,
        labels: range(display.labels, 0, 20, defaultDisplay.labels),
      } satisfies GraphDisplay,
    };
  } catch {
    return fallback;
  }
}
