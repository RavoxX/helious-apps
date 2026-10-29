import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { EdgeArrowProgram, EdgeLineProgram } from 'sigma/rendering';
import type { KnowledgeGraph, KnowledgeNode } from '@helious/core';
import type { GraphDisplay, GraphForces, LayoutMessage, LayoutResult } from './graph-layout-types';
export { defaultDisplay } from './graph-layout-types';
export interface GraphCanvasHandle {
  zoom(factor: number): void;
  reset(): void;
  focus(id: string): void;
}
const hash = (text: string) => {
  let n = 2166136261;
  for (const char of text) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 0;
};
export const GraphCanvas = forwardRef<
  GraphCanvasHandle,
  {
    data: KnowledgeGraph;
    forces: GraphForces;
    display: GraphDisplay;
    paused: boolean;
    cutoff: string | null;
    colors: Map<string, string>;
    focusId: string | null;
    open: (node: KnowledgeNode) => void;
    inspect: (node: KnowledgeNode | null) => void;
  }
>(function GraphCanvas(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma | null>(null);
  const worker = useRef<Worker | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const [error, setError] = useState('');
  const [settled, setSettled] = useState(false);
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      zoom(factor) {
        const camera = renderer.current?.getCamera();
        if (camera)
          void camera.animate({ ratio: camera.ratio * factor }, { duration: reduced ? 0 : 180 });
      },
      reset() {
        const view = renderer.current;
        if (view) {
          view.setCustomBBox(null);
          void view.getCamera().animatedReset({ duration: reduced ? 0 : 180 });
        }
      },
      focus(id) {
        const view = renderer.current;
        const point = view?.getNodeDisplayData(id);
        if (view && point)
          void view
            .getCamera()
            .animate({ x: point.x, y: point.y, ratio: 0.2 }, { duration: reduced ? 0 : 180 });
      },
    }),
    [reduced],
  );
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    setError('');
    setSettled(false);
    const probe = document.createElement('canvas');
    const context = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!context) {
      setError(
        'WebGL could not start. Enable hardware acceleration or use the note navigator below.',
      );
      return;
    }
    context.getExtension('WEBGL_lose_context')?.loseContext();
    const graph = new Graph({ type: 'directed', allowSelfLoops: true });
    const seed = props.data.nodes.map((node) => {
      const random = hash(node.id);
      const radius = Math.sqrt(props.data.nodes.length) * 22;
      const point = positions.current.get(node.id) ?? {
        x: ((random % 10007) / 10007 - 0.5) * radius,
        y: (((Math.imul(random, 48271) >>> 0) % 10009) / 10009 - 0.5) * radius,
      };
      graph.addNode(node.id, { ...point, label: node.title, color: '#78a7d6', size: 2.5 });
      return { id: node.id, ...point };
    });
    props.data.edges.forEach((edge, i) =>
      graph.addDirectedEdgeWithKey(String(i), edge.source, edge.target, {
        count: edge.count,
        color: '#454d5b',
        size: 0.6,
      }),
    );
    let sigma: Sigma;
    let allocated: Sigma | undefined;
    let engine: Worker;
    try {
      sigma = new Sigma(graph, host, {
        stagePadding: 42,
        labelFont: 'Manrope Variable, sans-serif',
        labelSize: 11,
        labelColor: { color: '#c8cdd5' },
        defaultDrawNodeHover: (context, data, settings) => {
          context.beginPath();
          context.arc(data.x, data.y, data.size + 1.5, 0, Math.PI * 2);
          context.strokeStyle = '#d6e4ff';
          context.lineWidth = 1.5;
          context.stroke();
          if (!data.label) return;
          context.font = `500 ${settings.labelSize}px ${settings.labelFont}`;
          const x = data.x + data.size + 8;
          const width = context.measureText(data.label).width;
          context.fillStyle = '#252a32';
          context.fillRect(x - 4, data.y - 11, width + 10, 22);
          context.fillStyle = '#e2e7ef';
          context.textBaseline = 'middle';
          context.fillText(data.label, x, data.y);
        },
        labelDensity: 0.06,
        labelGridCellSize: 100,
        labelRenderedSizeThreshold:
          props.data.nodes.length < 80 ? Math.min(2, props.display.labels) : props.display.labels,
        hideLabelsOnMove: true,
        minEdgeThickness: 0.25,
        defaultEdgeType: 'line',
        edgeProgramClasses: { line: EdgeLineProgram, arrow: EdgeArrowProgram },
        enableCameraRotation: false,
        minCameraRatio: 0.015,
        maxCameraRatio: 5,
        zoomDuration: reduced ? 0 : 180,
        doubleClickZoomingDuration: reduced ? 0 : 180,
        allowInvalidContainer: true,
      });
      allocated = sigma;
      engine = new Worker(new URL('./graph-layout.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      allocated?.kill();
      setError(
        'WebGL could not start. Enable hardware acceleration or use the note navigator below.',
      );
      return () => graph.clear();
    }
    renderer.current = sigma;
    worker.current = engine;
    const lookup = new Map(props.data.nodes.map((node) => [node.id, node]));
    let hovered: string | null = null;
    let neighbors = new Set<string>();
    let dragged: string | null = null;
    let moved = false;
    const visible = (id: string) =>
      !latest.current.cutoff || lookup.get(id)!.createdAt <= latest.current.cutoff;
    sigma.setSetting('nodeReducer', (id, attributes) => {
      const node = lookup.get(id)!;
      const degree = node.incoming + node.outgoing;
      const dim = !!hovered && id !== hovered && !neighbors.has(id);
      return {
        ...attributes,
        hidden: !visible(id),
        size:
          Math.min(14, (props.data.nodes.length < 80 ? 3 : 1.8) + Math.sqrt(degree) * 0.8) *
          Math.min(1, Math.max(0.35, Math.sqrt(500 / Math.max(1, props.data.nodes.length)))) *
          latest.current.display.nodeSize,
        color: dim
          ? '#333841'
          : (latest.current.colors.get(id) ?? (node.kind === 'missing' ? '#727986' : '#8da6c3')),
        label: dim ? null : node.title,
        highlighted: id === hovered || id === latest.current.focusId,
        forceLabel: id === hovered || id === latest.current.focusId,
        zIndex: id === hovered ? 1 : 0,
      };
    });
    sigma.setSetting('edgeReducer', (id, attributes) => {
      const [source, target] = graph.extremities(id);
      const active = hovered && (source === hovered || target === hovered);
      return {
        ...attributes,
        hidden: !visible(source) || !visible(target),
        color: active
          ? '#8fb6e8'
          : hovered
            ? '#242831'
            : props.data.nodes.length < 80
              ? '#647187'
              : '#414957',
        size: latest.current.display.edgeSize * Math.min(3, Math.sqrt(Number(attributes.count))),
        type: latest.current.display.arrows ? 'arrow' : 'line',
      };
    });
    sigma.on('enterNode', ({ node }) => {
      hovered = node;
      neighbors = new Set(graph.neighbors(node));
      latest.current.inspect(lookup.get(node)!);
      sigma.refresh();
      host.style.cursor = 'pointer';
    });
    sigma.on('leaveNode', () => {
      hovered = null;
      neighbors.clear();
      latest.current.inspect(null);
      sigma.refresh();
      host.style.cursor = '';
    });
    sigma.on('clickNode', ({ node }) => {
      if (!moved) latest.current.open(lookup.get(node)!);
    });
    sigma.on('downNode', ({ node }) => {
      dragged = node;
      moved = false;
      sigma.getCamera().disable();
      sigma.setCustomBBox(sigma.getBBox());
    });
    const endDrag = () => {
      if (dragged)
        engine.postMessage({ type: 'pin', id: dragged, x: null, y: null } satisfies LayoutMessage);
      dragged = null;
      sigma.getCamera().enable();
    };
    sigma.getMouseCaptor().on('mousemovebody', (event) => {
      if (!dragged) return;
      moved = true;
      const point = sigma.viewportToGraph(event);
      graph.mergeNodeAttributes(dragged, point);
      positions.current.set(dragged, point);
      engine.postMessage({ type: 'pin', id: dragged, ...point } satisfies LayoutMessage);
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });
    sigma.getMouseCaptor().on('mouseup', endDrag);
    // Suppress the synthetic click after a node drag before Sigma counts it as
    // the first half of a double-click. A subsequent intentional click opens normally.
    const dragClick = (event: MouseEvent) => {
      if (moved) {
        event.preventDefault();
        event.stopImmediatePropagation();
        sigma.getMouseCaptor().clicks = 0;
        moved = false;
      }
    };
    host.addEventListener('click', dragClick, true);
    sigma.getTouchCaptor().on('touchdown', (event) => {
      if (event.touches.length > 1) endDrag();
    });
    sigma.getTouchCaptor().on('touchmovebody', (event) => {
      if (!dragged || event.touches.length !== 1) return;
      moved = true;
      const point = sigma.viewportToGraph(event.touches[0]!);
      graph.mergeNodeAttributes(dragged, point);
      positions.current.set(dragged, point);
      engine.postMessage({ type: 'pin', id: dragged, ...point } satisfies LayoutMessage);
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });
    sigma.getTouchCaptor().on('touchup', endDrag);
    window.addEventListener('pointerup', endDrag);
    sigma.getCamera().on('updated', ({ ratio }) => {
      host.dataset.zoom = ratio.toFixed(3);
    });
    host.dataset.zoom = '1.000';
    host.dataset.ready = 'true';
    engine.onmessage = ({ data }: MessageEvent<LayoutResult>) => {
      if (data.positions.length !== seed.length * 2) return;
      let i = 0;
      graph.updateEachNodeAttributes(
        (id, attributes) => {
          const x = data.positions[i * 2]!;
          const y = data.positions[i++ * 2 + 1]!;
          if (id === dragged || !Number.isFinite(x) || !Number.isFinite(y)) return attributes;
          positions.current.set(id, { x, y });
          return { ...attributes, x, y };
        },
        { attributes: ['x', 'y'] },
      );
      setSettled(data.settled);
    };
    engine.onerror = () =>
      setError('The graph layout could not finish. You can still zoom, pan and open notes.');
    engine.postMessage({
      type: 'start',
      nodes: seed,
      edges: props.data.edges.map(({ source, target }) => ({ source, target })),
      forces: props.forces,
      reduced,
      paused: props.paused,
    } satisfies LayoutMessage);
    const visibility = () =>
      engine.postMessage({
        type: 'pause',
        paused: document.hidden || latest.current.paused,
      } satisfies LayoutMessage);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pointerup', endDrag);
      host.removeEventListener('click', dragClick, true);
      engine.terminate();
      sigma.kill();
      renderer.current = null;
      worker.current = null;
      host.dataset.ready = 'false';
    };
  }, [props.data, reduced]);
  useEffect(() => {
    worker.current?.postMessage({ type: 'forces', forces: props.forces } satisfies LayoutMessage);
    setSettled(false);
  }, [props.forces]);
  useEffect(() => {
    worker.current?.postMessage({
      type: 'pause',
      paused: props.paused || document.hidden,
    } satisfies LayoutMessage);
  }, [props.paused]);
  useEffect(() => {
    renderer.current?.setSetting(
      'labelRenderedSizeThreshold',
      props.data.nodes.length < 80 ? Math.min(2, props.display.labels) : props.display.labels,
    );
    renderer.current?.refresh();
  }, [props.display, props.colors, props.cutoff, props.focusId]);
  return (
    <>
      <div
        className="knowledge-canvas"
        ref={container}
        role="img"
        aria-label="Interactive knowledge graph. Drag to pan, scroll or pinch to zoom; choose a node to open its note. Keyboard navigation is available in the note navigator."
      />
      {error ? (
        <p role="alert" className="graph-render-error">
          {error}
        </p>
      ) : (
        <span className="graph-layout-state">
          {props.paused ? 'Layout paused' : settled ? 'Layout settled' : 'Arranging connections…'}
        </span>
      )}
    </>
  );
});
