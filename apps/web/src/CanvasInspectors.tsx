import { useEffect, useState } from 'react';
import type { CanvasNode, CanvasEdge } from '@helious/core';
const sides = ['top', 'right', 'bottom', 'left'] as const;
export function CardInspector({
  node,
  change,
  remove,
}: {
  node: CanvasNode;
  change: (node: CanvasNode) => void;
  remove: () => void;
}) {
  const [value, setValue] = useState(node.text ?? node.file ?? node.url ?? node.label ?? '');
  const [width, setWidth] = useState(node.width),
    [height, setHeight] = useState(node.height);
  const [color, setColor] = useState(node.color ?? '');
  useEffect(() => {
    setValue(node.text ?? node.file ?? node.url ?? node.label ?? '');
    setWidth(node.width);
    setHeight(node.height);
    setColor(node.color ?? '');
  }, [node]);
  return (
    <form
      className="canvas-inspector"
      aria-label="Edit selected card"
      onSubmit={(event) => {
        event.preventDefault();
        const next = { ...node, width, height, ...(color ? { color } : {}) };
        if (!color) delete next.color;
        if (node.type === 'text') next.text = value;
        else if (node.type === 'file') next.file = value;
        else if (node.type === 'link') next.url = value;
        else next.label = value;
        change(next);
      }}
    >
      <h3>Selected {node.type} card</h3>
      <label>
        Card content
        <textarea
          aria-label="Card content"
          value={value}
          maxLength={
            node.type === 'text'
              ? 20000
              : node.type === 'file'
                ? 1024
                : node.type === 'link'
                  ? 2048
                  : 200
          }
          onChange={(event) => setValue(event.target.value)}
          rows={3}
        />
      </label>
      <label>
        Card width
        <input
          type="number"
          min={100}
          max={4000}
          step={1}
          value={width}
          onChange={(event) => setWidth(Number(event.target.value))}
          required
        />
      </label>
      <label>
        Card height
        <input
          type="number"
          min={60}
          max={4000}
          step={1}
          value={height}
          onChange={(event) => setHeight(Number(event.target.value))}
          required
        />
      </label>
      <label>
        Card color
        <input
          value={color}
          maxLength={7}
          placeholder="1–6 or #rrggbb"
          onChange={(event) => setColor(event.target.value)}
        />
      </label>
      <button>Apply card changes</button>
      <button type="button" onClick={remove}>
        Remove card
      </button>
    </form>
  );
}

export function EdgeInspector({
  edge,
  change,
  remove,
}: {
  edge: CanvasEdge;
  change: (edge: CanvasEdge) => void;
  remove: () => void;
}) {
  return (
    <div className="canvas-edge-row">
      <label>
        Connection label
        <input
          value={edge.label ?? ''}
          maxLength={200}
          onChange={(event) => change({ ...edge, label: event.target.value })}
        />
      </label>
      <label>
        From side
        <select
          value={edge.fromSide ?? 'right'}
          onChange={(event) =>
            change({ ...edge, fromSide: event.target.value as CanvasEdge['fromSide'] })
          }
        >
          {sides.map((side) => (
            <option key={side}>{side}</option>
          ))}
        </select>
      </label>
      <label>
        To side
        <select
          value={edge.toSide ?? 'left'}
          onChange={(event) =>
            change({ ...edge, toSide: event.target.value as CanvasEdge['toSide'] })
          }
        >
          {sides.map((side) => (
            <option key={side}>{side}</option>
          ))}
        </select>
      </label>
      <label>
        Start arrow
        <select
          value={edge.fromEnd ?? 'none'}
          onChange={(event) =>
            change({ ...edge, fromEnd: event.target.value as CanvasEdge['fromEnd'] })
          }
        >
          <option>none</option>
          <option>arrow</option>
        </select>
      </label>
      <label>
        End arrow
        <select
          value={edge.toEnd ?? 'arrow'}
          onChange={(event) =>
            change({ ...edge, toEnd: event.target.value as CanvasEdge['toEnd'] })
          }
        >
          <option>none</option>
          <option>arrow</option>
        </select>
      </label>
      <button onClick={remove}>Remove connection</button>
    </div>
  );
}
