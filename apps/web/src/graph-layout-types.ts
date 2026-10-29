export interface GraphForces {
  center: number;
  repel: number;
  link: number;
  distance: number;
}
export const defaultForces: GraphForces = { center: 8, repel: 120, link: 0.08, distance: 50 };
export interface GraphDisplay {
  nodeSize: number;
  edgeSize: number;
  arrows: boolean;
  labels: number;
}
export const defaultDisplay: GraphDisplay = {
  nodeSize: 1,
  edgeSize: 0.65,
  arrows: false,
  labels: 7,
};
export type LayoutMessage =
  | {
      type: 'start';
      nodes: { id: string; x: number; y: number }[];
      edges: { source: string; target: string }[];
      forces: GraphForces;
      reduced: boolean;
      paused: boolean;
    }
  | { type: 'forces'; forces: GraphForces }
  | { type: 'pause'; paused: boolean }
  | { type: 'pin'; id: string; x: number | null; y: number | null };
export interface LayoutResult {
  positions: Float32Array;
  settled: boolean;
}
