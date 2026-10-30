import { expect, it } from 'vitest';
import { canvasEndpoint, parseCanvas, type CanvasNode } from './canvas.js';
const node: CanvasNode = {
  id: 'a',
  type: 'text',
  x: -120,
  y: 30,
  width: 240,
  height: 160,
  text: 'Plain text <script> is inert',
  color: '5',
};
const document = {
  nodes: [
    node,
    { ...node, id: 'b', type: 'file', text: undefined, file: 'Projects/Plan.md' },
    { ...node, id: 'c', type: 'link', text: undefined, url: 'https://example.com' },
    { ...node, id: 'group', type: 'group', text: undefined, label: 'Research' },
  ],
  edges: [
    {
      id: 'edge',
      fromNode: 'a',
      toNode: 'b',
      fromSide: 'bottom',
      toSide: 'top',
      toEnd: 'arrow',
      label: 'informs',
    },
  ],
};
it('round trips supported JSON Canvas cards and connections with exact geometry', () => {
  const source = JSON.stringify(document);
  expect(JSON.stringify(parseCanvas(source))).toBe(source);
  expect(canvasEndpoint(node, 'bottom')).toEqual({ x: 0, y: 190 });
  expect(canvasEndpoint(node, 'left')).toEqual({ x: -120, y: 110 });
  expect(parseCanvas('{}')).toEqual({ nodes: [], edges: [] });
});
it('refuses malformed, excessive, unsafe and unsupported canvas files without rewriting', () => {
  for (const value of [
    null,
    [],
    { nodes: null },
    { future: true },
    { nodes: [node, node] },
    { nodes: [{ ...node, width: 0 }] },
    { nodes: [{ ...node, x: 0.2 }] },
    { nodes: [{ ...node, color: 'red' }] },
    { nodes: [{ ...node, background: 'secret' }] },
    { nodes: [{ ...node, type: 'file', text: undefined, file: '../outside.md' }] },
    ...[
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'https://user:pass@example.com',
    ].map((url) => ({ nodes: [{ ...node, type: 'link', text: undefined, url }] })),
    { nodes: [node], edges: [{ id: 'e', fromNode: 'a', toNode: 'missing' }] },
    { nodes: [node], edges: [{ id: 'e', fromNode: 'a', toNode: 'a', toEnd: 'bad' }] },
    { nodes: [node], edges: [{ id: 'e', fromNode: ['a'], toNode: 'a' }] },
    { nodes: [{ ...node, id: '1' }], edges: [{ id: 'e', fromNode: 1, toNode: '1' }] },
    { nodes: [node], edges: [{ id: 'e', fromNode: 'a', toNode: 'a', fromSide: ['right'] }] },
    { nodes: [node], edges: [{ id: 'e', fromNode: 'a', toNode: 'a', toEnd: ['arrow'] }] },
    { nodes: Array.from({ length: 501 }, (_, id) => ({ ...node, id: String(id) })) },
  ])
    expect(() => parseCanvas(JSON.stringify(value))).toThrow();
  expect(() => parseCanvas(' '.repeat(1_000_001))).toThrow('limited');
});
