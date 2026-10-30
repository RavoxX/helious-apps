import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  canvasEndpoint,
  parseCanvas,
  type CanvasDocument,
  type CanvasNode,
  type CanvasEdge,
} from '@helious/core';
import { refreshVault } from './knowledge';
import { discardCanvasDraft, getCanvasDraft, keepCanvasDraft } from './drafts';
import { saveWorkspaceFile, type WorkspaceFile } from './workspace-files';
import { CardInspector, EdgeInspector } from './CanvasInspectors';
import { serialize, download, tint, type NoteLink } from './canvas-model';
export function CanvasBoard(props: {
  vaultId: string;
  file: WorkspaceFile;
  source: string;
  notes: NoteLink[];
  openNote: (id: string) => void;
  reload: () => void;
  onSaved: (file: WorkspaceFile, source: string) => void;
}) {
  const result = useMemo(() => {
    try {
      return { doc: parseCanvas(props.source), error: '' };
    } catch (error) {
      return {
        doc: null,
        error: error instanceof Error ? error.message : 'Cannot read this canvas.',
      };
    }
  }, [props.source]);
  if (!result.doc)
    return (
      <div role="alert">
        <p>{result.error} The stored file has not been changed.</p>
        <button onClick={() => download(props.file.path, props.source)}>
          Download original canvas
        </button>
        {getCanvasDraft(props.vaultId, props.file.path) && (
          <button
            onClick={() =>
              download(props.file.path, getCanvasDraft(props.vaultId, props.file.path)!.source)
            }
          >
            Download unsaved canvas draft
          </button>
        )}
      </div>
    );
  return <CanvasSurface {...props} initial={result.doc} />;
}

function CanvasSurface({
  vaultId,
  file,
  initial,
  notes,
  openNote,
  reload,
  onSaved,
}: {
  vaultId: string;
  file: WorkspaceFile;
  initial: CanvasDocument;
  notes: NoteLink[];
  openNote: (id: string) => void;
  reload: () => void;
  onSaved: (file: WorkspaceFile, source: string) => void;
}) {
  const client = useQueryClient();
  const marker = useId().replace(/:/g, '');
  const restored = useRef(getCanvasDraft(vaultId, file.path));
  const [doc, setDoc] = useState(() =>
    restored.current ? parseCanvas(restored.current.source) : initial,
  );
  const [saved, setSaved] = useState(initial);
  const [expected, setExpected] = useState(restored.current?.expected ?? file);
  const [past, setPast] = useState<CanvasDocument[]>([]);
  const [future, setFuture] = useState<CanvasDocument[]>([]);
  const [selection, setSelection] = useState('');
  const [kind, setKind] = useState<CanvasNode['type']>('text');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState('');
  const [confirmReload, setConfirmReload] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [camera, setCamera] = useState({ x: 30, y: 30, zoom: 1 });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: string;
    x: number;
    y: number;
    doc: CanvasDocument;
    camera: typeof camera;
  } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; x: number; y: number; camera: typeof camera } | null>(
    null,
  );
  const dirty = doc !== saved;
  const selected = doc.nodes.find((node) => node.id === selection);
  useEffect(() => {
    if (dirty) keepCanvasDraft(vaultId, file.path, { source: serialize(doc), expected });
    else discardCanvasDraft(vaultId, file.path);
  }, [doc, expected, dirty, vaultId, file.path]);
  function change(next: CanvasDocument) {
    try {
      parseCanvas(serialize(next));
      setPast((items) => [...items.slice(-29), doc]);
      setFuture([]);
      setDoc(next);
      setError('');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the canvas.');
      return false;
    }
  }
  const save = useMutation({
    mutationFn: async (snapshot: CanvasDocument) => ({
      snapshot,
      result: await saveWorkspaceFile(
        vaultId,
        expected.path,
        expected.spaceId,
        serialize(snapshot),
        expected,
      ),
    }),
    onSuccess: async ({ snapshot, result }) => {
      // The board may have unmounted while the request was in flight.
      const current = getCanvasDraft(vaultId, file.path);
      if (current?.source === serialize(snapshot)) discardCanvasDraft(vaultId, file.path);
      else if (current) keepCanvasDraft(vaultId, file.path, { ...current, expected: result.file });
      setExpected(result.file);
      setSaved(snapshot);
      onSaved(result.file, serialize(snapshot));
      await refreshVault(client, vaultId);
    },
  });
  const remove = useMutation({
    mutationFn: () => saveWorkspaceFile(vaultId, expected.path, expected.spaceId, null, expected),
    onSuccess: async () => {
      discardCanvasDraft(vaultId, file.path);
      await refreshVault(client, vaultId);
    },
  });
  function zoom(factor: number, x?: number, y?: number) {
    const rect = viewport.current?.getBoundingClientRect();
    const cx = x ?? (rect?.width ?? 600) / 2,
      cy = y ?? (rect?.height ?? 500) / 2;
    setCamera((old) => {
      const z = Math.max(0.001, Math.min(4, old.zoom * factor));
      return {
        x: cx - ((cx - old.x) * z) / old.zoom,
        y: cy - ((cy - old.y) * z) / old.zoom,
        zoom: z,
      };
    });
  }
  function fit(board = doc) {
    if (!board.nodes.length) {
      setCamera({ x: 30, y: 30, zoom: 1 });
      return;
    }
    const left = Math.min(...board.nodes.map((node) => node.x)),
      top = Math.min(...board.nodes.map((node) => node.y));
    const width = Math.max(...board.nodes.map((node) => node.x + node.width)) - left;
    const height = Math.max(...board.nodes.map((node) => node.y + node.height)) - top;
    const rect = viewport.current!.getBoundingClientRect();
    const z = Math.max(
      0.001,
      Math.min(1.5, (rect.width - 60) / width, (rect.height - 60) / height),
    );
    setCamera({
      x: (rect.width - width * z) / 2 - left * z,
      y: (rect.height - height * z) / 2 - top * z,
      zoom: z,
    });
  }
  useEffect(() => {
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.005), event.clientX - rect.left, event.clientY - rect.top);
    };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, []);
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,a')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    touches.current.set(event.pointerId, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (touches.current.size === 2) {
      finish();
      const [a, b] = [...touches.current.values()];
      pinch.current = {
        distance: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
        x: (a!.x + b!.x) / 2,
        y: (a!.y + b!.y) / 2,
        camera,
      };
      return;
    }
    const id =
      (event.target as HTMLElement).closest<HTMLElement>('[data-card-id]')?.dataset.cardId ?? '';
    setSelection(id);
    gesture.current = { id, x: event.clientX, y: event.clientY, doc, camera };
  }
  function finish() {
    const current = gesture.current;
    if (current?.id && current.doc !== doc) {
      setPast((items) => [...items.slice(-29), current.doc]);
      setFuture([]);
    }
    gesture.current = null;
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!touches.current.has(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    touches.current.set(event.pointerId, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    if (pinch.current && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()],
        start = pinch.current;
      const z = Math.max(
        0.001,
        Math.min(4, (start.camera.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / start.distance),
      );
      setCamera({
        x: (a!.x + b!.x) / 2 - ((start.x - start.camera.x) * z) / start.camera.zoom,
        y: (a!.y + b!.y) / 2 - ((start.y - start.camera.y) * z) / start.camera.zoom,
        zoom: z,
      });
      return;
    }
    const current = gesture.current;
    if (!current) return;
    const dx = event.clientX - current.x,
      dy = event.clientY - current.y;
    if (!current.id)
      setCamera({ ...current.camera, x: current.camera.x + dx, y: current.camera.y + dy });
    else
      setDoc({
        ...current.doc,
        nodes: current.doc.nodes.map((node) =>
          node.id === current.id
            ? {
                ...node,
                x: Math.max(
                  -100000,
                  Math.min(100000, Math.round(node.x + dx / current.camera.zoom)),
                ),
                y: Math.max(
                  -100000,
                  Math.min(100000, Math.round(node.y + dy / current.camera.zoom)),
                ),
              }
            : node,
        ),
      });
  }
  function add() {
    const id = crypto.randomUUID();
    const anchor =
      selected?.type !== 'group' && selected
        ? selected
        : doc.nodes.filter((node) => node.type !== 'group').at(-1);
    const node: CanvasNode = {
      id,
      type: kind,
      x: Math.max(
        -100000,
        Math.min(
          100000,
          Math.round(
            anchor && kind !== 'group'
              ? anchor.x + anchor.width + 60
              : (50 - camera.x) / camera.zoom,
          ),
        ),
      ),
      y: Math.max(
        -100000,
        Math.min(
          100000,
          Math.round(anchor && kind !== 'group' ? anchor.y : (50 - camera.y) / camera.zoom),
        ),
      ),
      width: kind === 'group' ? 560 : 280,
      height: kind === 'group' ? 360 : 180,
      ...(kind === 'text'
        ? { text: newValue }
        : kind === 'file'
          ? { file: newValue }
          : kind === 'link'
            ? { url: newValue }
            : { label: newValue }),
    };
    if (kind === 'group' && doc.nodes.length) {
      node.x = Math.max(-100000, Math.min(...doc.nodes.map((item) => item.x)) - 24);
      node.y = Math.max(-100000, Math.min(...doc.nodes.map((item) => item.y)) - 56);
      node.width = Math.min(
        4000,
        Math.max(100, Math.max(...doc.nodes.map((item) => item.x + item.width)) - node.x + 24),
      );
      node.height = Math.min(
        4000,
        Math.max(60, Math.max(...doc.nodes.map((item) => item.y + item.height)) - node.y + 24),
      );
    }
    const next = { ...doc, nodes: [...doc.nodes, node] };
    if (change(next)) {
      setSelection(id);
      setNewValue('');
      fit(next);
    }
  }
  const nodes = [
    ...doc.nodes.filter((node) => node.type === 'group'),
    ...doc.nodes.filter((node) => node.type !== 'group'),
  ];
  return (
    <div className="canvas-board" data-dirty={dirty}>
      <div className="canvas-toolbar">
        <strong>{expected.path}</strong>
        <span>{dirty ? 'Unsaved changes' : `Saved · revision ${expected.revision}`}</span>
        <button
          disabled={!dirty || save.isPending || remove.isPending}
          onClick={() => save.mutate(doc)}
        >
          Save canvas
        </button>
        <button
          disabled={!past.length || save.isPending}
          onClick={() => {
            setFuture((items) => [doc, ...items]);
            setDoc(past.at(-1)!);
            setPast((items) => items.slice(0, -1));
          }}
        >
          Undo
        </button>
        <button
          disabled={!future.length || save.isPending}
          onClick={() => {
            setPast((items) => [...items, doc]);
            setDoc(future[0]!);
            setFuture((items) => items.slice(1));
          }}
        >
          Redo
        </button>
        <button onClick={() => download(expected.path, serialize(doc))}>Download canvas</button>
        <button
          disabled={save.isPending || remove.isPending}
          onClick={() => (dirty ? setConfirmReload(true) : reload())}
        >
          Reload canvas
        </button>
      </div>
      {confirmReload && (
        <div className="canvas-confirm" role="alert">
          <p>Discard this canvas draft and load the latest saved file?</p>
          <button
            onClick={() => {
              discardCanvasDraft(vaultId, file.path);
              reload();
            }}
          >
            Discard canvas draft and reload
          </button>
          <button onClick={() => setConfirmReload(false)}>Keep editing</button>
        </div>
      )}
      {(error || save.error || remove.error) && (
        <p role="alert" className="error-message">
          {error || save.error?.message || remove.error?.message} Your draft is kept. Download it or
          reload the latest file before retrying a stale save.
        </p>
      )}
      <div className="canvas-add">
        <label>
          Card type
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as CanvasNode['type']);
              setNewValue('');
            }}
          >
            {['text', 'file', 'link', 'group'].map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>
          New card content
          {kind === 'file' ? (
            <select value={newValue} onChange={(event) => setNewValue(event.target.value)}>
              <option value="">Choose a note</option>
              {notes.map((note) => (
                <option key={note.id} value={note.path}>
                  {note.path}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              maxLength={kind === 'text' ? 20000 : kind === 'link' ? 2048 : 200}
              placeholder={
                kind === 'link'
                  ? 'https://…'
                  : kind === 'group'
                    ? 'Group name'
                    : 'An idea to connect'
              }
            />
          )}
        </label>
        <button disabled={(kind === 'file' || kind === 'link') && !newValue} onClick={add}>
          Add card
        </button>
      </div>
      <div className="canvas-camera">
        <button onClick={() => zoom(1 / 1.2)} aria-label="Zoom out canvas">
          −
        </button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button onClick={() => zoom(1.2)} aria-label="Zoom in canvas">
          +
        </button>
        <button onClick={() => fit()}>Fit cards</button>
      </div>
      <p id={`${marker}-help`} className="canvas-help">
        Drag empty space to pan. Pinch or Ctrl/⌘ + wheel to zoom. Select a card, then use arrow keys
        to move it (Shift for larger steps). Edit text and size below.
      </p>
      <div
        ref={viewport}
        className="canvas-viewport"
        aria-label="Canvas board"
        aria-describedby={`${marker}-help`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(event) => {
          finish();
          touches.current.delete(event.pointerId);
          pinch.current = null;
        }}
        onPointerCancel={() => {
          finish();
          touches.current.clear();
          pinch.current = null;
        }}
      >
        <div
          className="canvas-world"
          style={{ transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})` }}
        >
          <svg className="canvas-connections" aria-hidden="true">
            <defs>
              <marker
                id={`${marker}-arrow`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10z" fill="context-stroke" />
              </marker>
            </defs>
            {doc.edges.map((edge) => {
              const a = canvasEndpoint(
                doc.nodes.find((node) => node.id === edge.fromNode)!,
                edge.fromSide,
              );
              const b = canvasEndpoint(
                doc.nodes.find((node) => node.id === edge.toNode)!,
                edge.toSide ?? 'left',
              );
              const distance = Math.max(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
              const control = (p: typeof a, side: CanvasEdge['fromSide']) => ({
                x: p.x + (side === 'left' ? -distance : side === 'right' ? distance : 0),
                y: p.y + (side === 'top' ? -distance : side === 'bottom' ? distance : 0),
              });
              const ca = control(a, edge.fromSide ?? 'right'),
                cb = control(b, edge.toSide ?? 'left');
              return (
                <g key={edge.id} style={{ color: tint(edge.color) }}>
                  <path
                    d={`M${a.x} ${a.y} C${ca.x} ${ca.y} ${cb.x} ${cb.y} ${b.x} ${b.y}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    markerStart={edge.fromEnd === 'arrow' ? `url(#${marker}-arrow)` : undefined}
                    markerEnd={edge.toEnd !== 'none' ? `url(#${marker}-arrow)` : undefined}
                  />
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 8}
                    fill="currentColor"
                    textAnchor="middle"
                  >
                    {edge.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {nodes.map((node) => (
            <div
              key={node.id}
              data-card-id={node.id}
              className={`canvas-card ${node.type === 'group' ? 'canvas-group' : ''}`}
              role="group"
              aria-label={`${node.type} card`}
              data-selected={selection === node.id}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                borderColor: selection === node.id ? 'var(--color-brand)' : tint(node.color),
              }}
              onClick={() => setSelection(node.id)}
              onKeyDown={(event) => {
                if (!(event.target as HTMLElement).classList.contains('canvas-card-select')) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelection(node.id);
                }
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                  event.preventDefault();
                  setSelection(node.id);
                  const step = event.shiftKey ? 50 : 10;
                  change({
                    ...doc,
                    nodes: doc.nodes.map((item) =>
                      item.id === node.id
                        ? {
                            ...item,
                            x:
                              item.x +
                              (event.key === 'ArrowLeft'
                                ? -step
                                : event.key === 'ArrowRight'
                                  ? step
                                  : 0),
                            y:
                              item.y +
                              (event.key === 'ArrowUp'
                                ? -step
                                : event.key === 'ArrowDown'
                                  ? step
                                  : 0),
                          }
                        : item,
                    ),
                  });
                }
              }}
            >
              <button
                className="canvas-card-select"
                aria-label={`Select ${node.type} card ${node.type === 'text' ? node.text?.slice(0, 80) || 'Untitled' : (node.file ?? node.url ?? node.label)}`}
                aria-pressed={selection === node.id}
                onClick={() => setSelection(node.id)}
              >
                {node.type === 'group'
                  ? node.label || 'Group'
                  : node.type === 'file'
                    ? 'Note'
                    : node.type}{' '}
                · select
              </button>
              <div className="canvas-card-content">
                {node.type === 'group' ? '' : (node.text ?? node.file ?? node.url)}
              </div>
              {node.type === 'file' && (
                <button
                  onClick={() => {
                    const note = notes.find((item) => item.path === node.file);
                    if (note) openNote(note.id);
                    else
                      setError(
                        'This note is not in the current Space/index. Change the Space filter or open it from the explorer.',
                      );
                  }}
                >
                  Open note
                </button>
              )}
              {node.type === 'link' && (
                <a href={node.url} target="_blank" rel="noreferrer">
                  Open website ↗
                </a>
              )}
            </div>
          ))}
          {!doc.nodes.length && (
            <p className="canvas-empty">Add a card above to start your board.</p>
          )}
        </div>
      </div>
      {selected && (
        <CardInspector
          key={selected.id + ':' + selected.type}
          node={selected}
          change={(next) =>
            change({ ...doc, nodes: doc.nodes.map((node) => (node.id === next.id ? next : node)) })
          }
          remove={() => {
            change({
              nodes: doc.nodes.filter((node) => node.id !== selected.id),
              edges: doc.edges.filter(
                (edge) => edge.fromNode !== selected.id && edge.toNode !== selected.id,
              ),
            });
            setSelection('');
          }}
        />
      )}
      <details className="canvas-edge-editor">
        <summary>Connections ({doc.edges.length})</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            change({
              ...doc,
              edges: [
                ...doc.edges,
                {
                  id: crypto.randomUUID(),
                  fromNode: from,
                  toNode: to,
                  fromSide: 'right',
                  toSide: 'left',
                  toEnd: 'arrow',
                },
              ],
            });
          }}
        >
          <label>
            From card
            <select value={from} onChange={(event) => setFrom(event.target.value)}>
              <option value="">Choose a card</option>
              {doc.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {(node.text ?? node.file ?? node.url ?? node.label ?? node.type).slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
          <label>
            To card
            <select value={to} onChange={(event) => setTo(event.target.value)}>
              <option value="">Choose a card</option>
              {doc.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {(node.text ?? node.file ?? node.url ?? node.label ?? node.type).slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!from || !to}>Connect cards</button>
        </form>
        {doc.edges.map((edge) => (
          <EdgeInspector
            key={edge.id}
            edge={edge}
            change={(next) =>
              change({
                ...doc,
                edges: doc.edges.map((item) => (item.id === next.id ? next : item)),
              })
            }
            remove={() =>
              change({ ...doc, edges: doc.edges.filter((item) => item.id !== edge.id) })
            }
          />
        ))}
      </details>
      <footer>
        <p>
          Canvas cards are plain text. Links open only when clicked. Groups are visual boundaries;
          moving a group does not move its cards. Save explicitly; drafts stay in this tab’s memory
          until saved or discarded.
        </p>
        <button
          disabled={save.isPending || remove.isPending}
          onClick={() => setConfirmDelete(true)}
        >
          Delete canvas…
        </button>
        {confirmDelete && (
          <div role="alert">
            <p>
              Delete this saved canvas? This also discards its draft. Canvas files do not have note
              version history.
            </p>
            <button disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete saved canvas
            </button>
            <button onClick={() => setConfirmDelete(false)}>Keep canvas</button>
          </div>
        )}
      </footer>
    </div>
  );
}
