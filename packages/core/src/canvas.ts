import { normalizeVaultPath } from './paths.js';
export interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  color?: string;
}
export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
  color?: string;
  fromEnd?: 'none' | 'arrow';
  toEnd?: 'none' | 'arrow';
}
export interface CanvasDocument {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 20000): value is string =>
  typeof value === 'string' && value.length <= max;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,100}$/.test(v);
const color = (v: unknown) =>
  v === undefined || (typeof v === 'string' && /^(?:[1-6]|#[a-f\d]{6})$/i.test(v));
export function parseCanvas(source: string): CanvasDocument {
  if (source.length > 1_000_000)
    throw new Error('Canvas files are limited to 1,000,000 characters.');
  const value: unknown = JSON.parse(source);
  if (!record(value) || Object.keys(value).some((k) => !['nodes', 'edges'].includes(k)))
    throw new Error('Use a JSON Canvas object with nodes and edges.');
  const nodes = value.nodes === undefined ? [] : value.nodes,
    edges = value.edges === undefined ? [] : value.edges;
  if (!Array.isArray(nodes) || nodes.length > 500 || !Array.isArray(edges) || edges.length > 1000)
    throw new Error('A canvas supports up to 500 cards and 1,000 connections.');
  const ids = new Set<string>();
  for (const node of nodes) {
    if (
      !record(node) ||
      !identifier(node.id) ||
      ids.has(node.id) ||
      typeof node.type !== 'string' ||
      !['text', 'file', 'link', 'group'].includes(node.type) ||
      ['x', 'y', 'width', 'height'].some(
        (k) => !Number.isInteger(node[k]) || Math.abs(Number(node[k])) > 100000,
      ) ||
      Number(node.width) < 100 ||
      Number(node.width) > 4000 ||
      Number(node.height) < 60 ||
      Number(node.height) > 4000 ||
      !color(node.color)
    )
      throw new Error('Invalid canvas card geometry, color or identifier.');
    const fields = [
      'id',
      'type',
      'x',
      'y',
      'width',
      'height',
      'color',
      ...(node.type === 'text'
        ? ['text']
        : node.type === 'file'
          ? ['file', 'subpath']
          : node.type === 'link'
            ? ['url']
            : ['label']),
    ];
    if (Object.keys(node).some((k) => !fields.includes(k)))
      throw new Error(
        'This canvas contains unsupported card fields. The original file has not been changed.',
      );
    if (node.type === 'text' && !text(node.text)) throw new Error('Invalid text card.');
    if (node.type === 'file') {
      if (!text(node.file, 1024)) throw new Error('Invalid file card.');
      normalizeVaultPath(node.file);
      if (node.subpath !== undefined && (!text(node.subpath, 200) || !node.subpath.startsWith('#')))
        throw new Error('Invalid file fragment.');
    }
    if (node.type === 'link') {
      if (!text(node.url, 2048)) throw new Error('Invalid link card.');
      const url = new URL(node.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Link cards support HTTP(S) URLs without credentials.');
    }
    if (node.label !== undefined && !text(node.label, 200)) throw new Error('Invalid group label.');
    ids.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (
      !record(edge) ||
      !identifier(edge.id) ||
      edgeIds.has(edge.id) ||
      !identifier(edge.fromNode) ||
      !ids.has(edge.fromNode) ||
      !identifier(edge.toNode) ||
      !ids.has(edge.toNode) ||
      !color(edge.color) ||
      Object.keys(edge).some(
        (k) =>
          ![
            'id',
            'fromNode',
            'toNode',
            'fromSide',
            'toSide',
            'label',
            'color',
            'fromEnd',
            'toEnd',
          ].includes(k),
      ) ||
      ['fromSide', 'toSide'].some(
        (k) =>
          edge[k] !== undefined &&
          (typeof edge[k] !== 'string' || !['top', 'right', 'bottom', 'left'].includes(edge[k])),
      ) ||
      ['fromEnd', 'toEnd'].some(
        (k) =>
          edge[k] !== undefined &&
          (typeof edge[k] !== 'string' || !['none', 'arrow'].includes(edge[k])),
      ) ||
      (edge.label !== undefined && !text(edge.label, 200))
    )
      throw new Error('Invalid canvas connection.');
    edgeIds.add(edge.id);
  }
  return { nodes: nodes as unknown as CanvasNode[], edges: edges as unknown as CanvasEdge[] };
}
export function canvasEndpoint(node: CanvasNode, side: CanvasEdge['fromSide'] = 'right') {
  return {
    x: node.x + (side === 'left' ? 0 : side === 'right' ? node.width : node.width / 2),
    y: node.y + (side === 'top' ? 0 : side === 'bottom' ? node.height : node.height / 2),
  };
}
