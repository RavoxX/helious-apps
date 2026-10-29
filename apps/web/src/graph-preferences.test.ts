import { afterEach, expect, it, vi } from 'vitest';
import { graphPreferences } from './graph-preferences';
import { defaultForces } from './graph-layout-types';
afterEach(() => vi.unstubAllGlobals());
it('loads bounded graph settings and discards invalid colors, queries and force ranges', () => {
  vi.stubGlobal('localStorage', {
    getItem: () =>
      JSON.stringify({
        forces: { repel: 9000, distance: 80 },
        display: { nodeSize: -1, arrows: true },
        groups: [
          { query: 'tag:code', color: '#88aacc' },
          { query: 'line:1', color: '#ffffff' },
          { query: 'tag:code', color: 'url(unsafe)' },
        ],
      }),
  });
  const saved = graphPreferences('one');
  expect(saved.forces).toMatchObject({ repel: defaultForces.repel, distance: 80 });
  expect(saved.display).toMatchObject({ nodeSize: 1, arrows: true });
  expect(saved.groups).toEqual([{ query: 'tag:code', color: '#88aacc' }]);
});
it('recovers from unavailable or corrupted storage and limits custom groups', () => {
  vi.stubGlobal('localStorage', { getItem: () => '{broken' });
  expect(graphPreferences('one').forces).toEqual(defaultForces);
  vi.stubGlobal('localStorage', {
    getItem: () =>
      JSON.stringify({
        groups: Array.from({ length: 100 }, () => ({ query: 'code', color: '#88aacc' })),
      }),
  });
  expect(graphPreferences('one').groups).toHaveLength(12);
});
