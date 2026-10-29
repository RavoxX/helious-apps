import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceX,
  forceY,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force';
import { type GraphForces, type LayoutMessage, type LayoutResult } from './graph-layout-types';
interface Node extends SimulationNodeDatum {
  id: string;
}
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LayoutMessage>) => void) | null;
  postMessage(value: LayoutResult, transfer: Transferable[]): void;
};
let simulation: Simulation<Node, undefined> | null = null;
let nodes: Node[] = [];
let lookup = new Map<string, Node>();
let timer: ReturnType<typeof setTimeout> | undefined;
let paused = false;
let reduced = false;
let started = 0;
let emitted = 0;
function emit(settled: boolean) {
  const positions = new Float32Array(nodes.length * 2);
  nodes.forEach((node, i) => {
    positions[i * 2] = node.x ?? 0;
    positions[i * 2 + 1] = node.y ?? 0;
  });
  scope.postMessage({ positions, settled }, [positions.buffer]);
  emitted = performance.now();
}
function tick() {
  if (!simulation || paused) return;
  simulation.tick(reduced ? 6 : 1);
  const settled = simulation.alpha() < 0.006 || performance.now() - started > 12000;
  if (settled || (!reduced && performance.now() - emitted > 90)) emit(settled);
  if (!settled) timer = setTimeout(tick, reduced ? 0 : 12);
}
function forces(value: GraphForces) {
  if (!simulation) return;
  simulation.force(
    'charge',
    forceManyBody<Node>().strength(-value.repel).theta(1.1).distanceMax(2200),
  );
  simulation.force('x', forceX<Node>(0).strength(value.center / 1000));
  simulation.force('y', forceY<Node>(0).strength(value.center / 1000));
  const link = simulation.force('links') as ReturnType<
    typeof forceLink<Node, { source: string; target: string }>
  >;
  link?.distance(value.distance).strength(value.link);
  simulation.alpha(0.7);
  started = performance.now();
}
scope.onmessage = ({ data }) => {
  if (data.type === 'start') {
    clearTimeout(timer);
    simulation?.stop();
    nodes = data.nodes;
    lookup = new Map(nodes.map((node) => [node.id, node]));
    paused = data.paused;
    reduced = data.reduced;
    simulation = forceSimulation(nodes)
      .stop()
      .alphaDecay(0.025)
      .velocityDecay(0.35)
      .force(
        'links',
        forceLink<Node, { source: string; target: string }>(data.edges).id((node) => node.id),
      )
      .force('collision', forceCollide<Node>(4).iterations(1));
    forces(data.forces);
    emit(false);
    tick();
  } else if (data.type === 'forces') {
    clearTimeout(timer);
    forces(data.forces);
    tick();
  } else if (data.type === 'pause') {
    paused = data.paused;
    clearTimeout(timer);
    if (!paused) {
      simulation?.alpha(0.3);
      started = performance.now();
      tick();
    }
  } else {
    const node = lookup.get(data.id);
    if (node) {
      node.fx = data.x;
      node.fy = data.y;
      if (data.x !== null && data.y !== null) {
        node.x = data.x;
        node.y = data.y;
        node.vx = 0;
        node.vy = 0;
      }
    }
  }
};
