import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Download,
  FileText,
  Focus,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  filterKnowledgeGraph,
  graphQuery,
  type KnowledgeGraph,
  type KnowledgeNode,
} from '@helious/core';
import { api } from './api';
import { AttachmentLink } from './AttachmentLink';
import { spaceQuery } from './knowledge';
import { GraphCanvas, defaultDisplay, type GraphCanvasHandle } from './GraphCanvas';
import { defaultForces } from './graph-layout-types';
import { graphPreferences, type ColorGroup } from './graph-preferences';
import './insights.css';

const palette = ['#8caee3', '#b09cdd', '#7cc3a5', '#d5b675', '#dd94a9', '#83c9d1'];
const folderColor = (path: string) => {
  let code = 0;
  for (const char of path.split('/')[0]!) code = Math.imul(code, 31) + char.charCodeAt(0);
  return palette[(code >>> 0) % palette.length]!;
};
function Slider({
  label,
  value,
  set,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  set: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="graph-slider">
      <span>
        {label}
        <output>{value}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => set(Number(event.target.value))}
      />
    </label>
  );
}
export function GraphExplorer({
  vaultId,
  userId,
  initialRoot,
  spaceId = '',
  onOpen,
  onNotes,
}: {
  vaultId: string;
  userId: string;
  initialRoot: string | null;
  spaceId?: string;
  onOpen: (id: string) => void;
  onNotes: () => void;
}) {
  const key = `helious-graph:${userId}:${vaultId}`;
  const [saved] = useState(() => graphPreferences(key));
  const query = useQuery({
    queryKey: ['graph', vaultId, spaceId],
    queryFn: () =>
      api<KnowledgeGraph>(
        `/vaults/${vaultId}/graph?includeFiles=true${spaceId ? `&${spaceQuery(spaceId)}` : ''}`,
      ),
    refetchOnWindowFocus: false,
  });
  const [root, setRoot] = useState<string | null>(initialRoot);
  const [depth, setDepth] = useState(1);
  const [filter, setFilter] = useState('');
  const [attachments, setAttachments] = useState(false);
  const [orphans, setOrphans] = useState(true);
  const [existing, setExisting] = useState(true);
  const [groups, setGroups] = useState<ColorGroup[]>(saved.groups);
  const [draftGroup, setDraftGroup] = useState('');
  const [draftColor, setDraftColor] = useState(palette[0]!);
  const [grouping, setGrouping] = useState(saved.grouping);
  const [forces, setForces] = useState(saved.forces);
  const [display, setDisplay] = useState(saved.display);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ groups, grouping, forces, display }));
    } catch {
      /* Settings remain available in this view. */
    }
  }, [key, groups, grouping, forces, display]);
  const [paused, setPaused] = useState(false);
  const [settings, setSettings] = useState(false);
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);
  const [find, setFind] = useState('');
  const [groupError, setGroupError] = useState('');
  const [time, setTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const canvas = useRef<GraphCanvasHandle>(null);
  const filtered = useMemo(() => {
    if (!query.data) return { graph: null, error: '' };
    try {
      return {
        graph: filterKnowledgeGraph(query.data, {
          query: filter,
          attachments,
          orphans,
          existingOnly: existing,
          root,
          depth,
        }),
        error: '',
      };
    } catch (error) {
      return { graph: null, error: error instanceof Error ? error.message : 'Invalid filter' };
    }
  }, [query.data, filter, attachments, orphans, existing, root, depth]);
  const dates = useMemo(
    () =>
      [
        ...new Set(
          filtered.graph?.nodes
            .filter((node) => node.kind !== 'missing')
            .map((node) => node.createdAt) ?? [],
        ),
      ].sort(),
    [filtered.graph],
  );
  const timeIndex = Math.min(time ?? dates.length - 1, dates.length - 1);
  const cutoff = time === null ? null : (dates[Math.max(0, timeIndex)] ?? null);
  const visibleNodes = useMemo(
    () => filtered.graph?.nodes.filter((node) => !cutoff || node.createdAt <= cutoff) ?? [],
    [filtered.graph, cutoff],
  );
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((node) => node.id));
    return (
      filtered.graph?.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).length ??
      0
    );
  }, [visibleNodes, filtered.graph]);
  useEffect(() => {
    if (selected && !visibleNodes.some((node) => node.id === selected.id)) setSelected(null);
  }, [visibleNodes, selected]);
  const colors = useMemo(() => {
    const matchers = groups.map((group) => ({ ...group, matches: graphQuery(group.query) }));
    return new Map(
      (filtered.graph?.nodes ?? []).map((node) => {
        const custom = matchers.find((group) => group.matches(node));
        return [
          node.id,
          custom?.color ??
            (node.kind === 'missing'
              ? '#727986'
              : node.kind === 'attachment'
                ? '#a0a8b4'
                : grouping === 'folder'
                  ? folderColor(node.path.includes('/') ? node.path : '_root')
                  : grouping === 'tag'
                    ? folderColor(node.tags[0] ?? '_untagged')
                    : '#8caee3'),
        ];
      }),
    );
  }, [filtered.graph, groups, grouping]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () => {
        if (document.hidden) {
          setPlaying(false);
          return;
        }
        setTime((current) => {
          const next = (current ?? -1) + Math.max(1, Math.ceil(dates.length / 90));
          if (next >= dates.length - 1) {
            setPlaying(false);
            return Math.max(0, dates.length - 1);
          }
          return next;
        });
      },
      Math.max(60, Math.min(400, 6000 / Math.max(1, Math.min(90, dates.length)))),
    );
    return () => clearInterval(id);
  }, [playing, dates.length]);
  useEffect(() => {
    setPlaying(false);
    setTime(null);
  }, [filter, root, depth, attachments, orphans, existing]);
  const open = (node: KnowledgeNode) => {
    if (node.kind === 'note') onOpen(node.id);
    else setSelected(node);
  };
  const resetFilters = () => {
    setFilter('');
    setAttachments(false);
    setOrphans(true);
    setExisting(true);
    setRoot(null);
  };
  return (
    <section className="graph-workspace" aria-label="Knowledge graph">
      <header className="insights-heading">
        <div>
          <h2>{root ? 'Local graph' : 'Your knowledge, connected.'}</h2>
          <p>Follow a connection. Find your next thought.</p>
        </div>
        <button
          className="secondary-button"
          aria-expanded={settings}
          aria-controls="graph-settings"
          onClick={() => setSettings(!settings)}
        >
          <SlidersHorizontal size={15} /> Controls
        </button>
      </header>
      {query.isPending && (
        <div className="insights-loading" role="status">
          Loading your notes and connections…
        </div>
      )}
      {query.error && (
        <div className="insights-error" role="alert">
          <p>{query.error.message}</p>
          <button className="secondary-button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}
      {query.data && (
        <>
          <div className="graph-mode-row">
            <div role="group" aria-label="Graph scope">
              <button aria-pressed={!root} onClick={() => setRoot(null)}>
                Global graph
              </button>
              <button
                aria-pressed={!!root}
                disabled={!query.data.nodes.some((node) => node.kind === 'note')}
                onClick={() =>
                  setRoot(initialRoot ?? query.data.nodes.find((node) => node.kind === 'note')!.id)
                }
              >
                Local graph
              </button>
            </div>
            <span role="status">
              {visibleNodes.length.toLocaleString()} nodes · {visibleEdges.toLocaleString()}{' '}
              connections
            </span>
          </div>
          <div className={`graph-layout ${settings ? 'controls-open' : ''}`}>
            <div className="graph-stage">
              {filtered.graph && filtered.graph.nodes.length > 0 ? (
                <GraphCanvas
                  ref={canvas}
                  data={filtered.graph}
                  forces={forces}
                  display={display}
                  paused={paused}
                  cutoff={cutoff}
                  colors={colors}
                  focusId={root ?? selected?.id ?? null}
                  open={open}
                  inspect={(node) => {
                    if (node) setSelected(node);
                  }}
                />
              ) : (
                <div className="graph-blank">
                  <h3>
                    {query.data.nodes.length
                      ? 'No connections in this view.'
                      : 'Give your ideas a connection.'}
                  </h3>
                  <p>
                    {filtered.error ||
                      (query.data.nodes.length
                        ? 'Try a different filter, or include orphans and unresolved links.'
                        : 'Create a few notes and connect them with [[wikilinks]]. Your graph will grow from there.')}
                  </p>
                  <button
                    className="secondary-button"
                    onClick={query.data.nodes.length ? resetFilters : onNotes}
                  >
                    {query.data.nodes.length ? 'Reset filters' : 'Write a note'}
                  </button>
                </div>
              )}
              <div className="graph-camera-tools" role="group" aria-label="Graph camera">
                <button
                  aria-label="Zoom in knowledge graph"
                  onClick={() => canvas.current?.zoom(0.7)}
                >
                  <Plus size={16} />
                </button>
                <button
                  aria-label="Zoom out knowledge graph"
                  onClick={() => canvas.current?.zoom(1.4)}
                >
                  <Minus size={16} />
                </button>
                <button
                  aria-label="Reset knowledge graph camera"
                  onClick={() => canvas.current?.reset()}
                >
                  <Focus size={16} />
                </button>
                <button
                  aria-label={paused ? 'Resume graph layout' : 'Pause graph layout'}
                  aria-pressed={paused}
                  onClick={() => setPaused(!paused)}
                >
                  {paused ? <Play size={15} /> : <Pause size={15} />}
                </button>
              </div>
              {selected && (
                <div className="graph-selection">
                  <span style={{ backgroundColor: colors.get(selected.id) }} />
                  <div>
                    <strong>{selected.title}</strong>
                    <small>
                      {selected.path} · {selected.incoming} incoming · {selected.outgoing} outgoing
                    </small>
                  </div>
                  {selected.kind === 'note' ? (
                    <button
                      aria-label={`Open ${selected.path} from graph`}
                      onClick={() => onOpen(selected.id)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  ) : selected.kind === 'attachment' ? (
                    <AttachmentLink
                      label={`Download ${selected.path}`}
                      vaultId={vaultId}
                      id={selected.id.slice(11)}
                      path={selected.path}
                    >
                      <Download size={17} />
                    </AttachmentLink>
                  ) : (
                    <small>Unresolved</small>
                  )}
                </div>
              )}
            </div>
            <aside id="graph-settings" className="graph-settings" hidden={!settings}>
              <details open>
                <summary>Filters</summary>
                <label>
                  Filter titles, paths and tags
                  <input
                    aria-label="Graph filter"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    maxLength={256}
                    placeholder="tag:code path:Projects"
                  />
                </label>
                {filtered.error && <p role="alert">{filtered.error}</p>}
                <label className="graph-check">
                  <input
                    type="checkbox"
                    checked={attachments}
                    onChange={(event) => setAttachments(event.target.checked)}
                  />{' '}
                  Attachments
                </label>
                <label className="graph-check">
                  <input
                    type="checkbox"
                    checked={orphans}
                    onChange={(event) => setOrphans(event.target.checked)}
                  />{' '}
                  Orphan notes
                </label>
                <label className="graph-check">
                  <input
                    type="checkbox"
                    checked={existing}
                    onChange={(event) => setExisting(event.target.checked)}
                  />{' '}
                  Existing files only
                </label>
                {root && (
                  <>
                    <label>
                      Center note
                      <select
                        aria-label="Local graph center"
                        value={root}
                        onChange={(event) => setRoot(event.target.value)}
                      >
                        {query.data.nodes
                          .filter((node) => node.kind === 'note')
                          .map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.path}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Slider
                      label="Local graph depth"
                      min={1}
                      max={5}
                      value={depth}
                      set={setDepth}
                    />
                  </>
                )}
                <p>
                  Use the Space selector above to filter permitted notes and attachments.
                  Hidden-space links and counts are excluded by the server.
                </p>
              </details>
              <details>
                <summary>Groups</summary>
                <label>
                  Color nodes by
                  <select
                    aria-label="Color nodes by"
                    value={grouping}
                    onChange={(event) => setGrouping(event.target.value as typeof grouping)}
                  >
                    <option value="folder">Folder</option>
                    <option value="tag">First tag</option>
                    <option value="none">One color</option>
                  </select>
                </label>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    try {
                      graphQuery(draftGroup);
                      if (!draftGroup.trim()) throw new Error('Enter a query for this group.');
                      if (groups.length >= 12) throw new Error('Use up to 12 color groups.');
                      setGroups([...groups, { query: draftGroup.trim(), color: draftColor }]);
                      setDraftGroup('');
                      setGroupError('');
                    } catch (error) {
                      setGroupError((error as Error).message);
                    }
                  }}
                >
                  <label>
                    Group query
                    <input
                      aria-label="Group query"
                      value={draftGroup}
                      maxLength={256}
                      onChange={(event) => setDraftGroup(event.target.value)}
                      placeholder="tag:research"
                    />
                  </label>
                  <label className="graph-color">
                    Group color
                    <input
                      type="color"
                      aria-label="Group color"
                      value={draftColor}
                      onChange={(event) => setDraftColor(event.target.value)}
                    />
                  </label>
                  <button className="secondary-button">Add group</button>
                </form>
                {groupError && <p role="alert">{groupError}</p>}
                {groups.map((group, i) => (
                  <div className="graph-group" key={`${group.query}:${i}`}>
                    <span style={{ backgroundColor: group.color }} />
                    <span>{group.query}</span>
                    <button
                      aria-label={`Remove group ${group.query}`}
                      onClick={() => setGroups(groups.filter((_group, index) => index !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <p>The first matching custom group wins.</p>
              </details>
              <details>
                <summary>Display</summary>
                <Slider
                  label="Node size"
                  value={display.nodeSize}
                  min={0.5}
                  max={3}
                  step={0.1}
                  set={(value) => setDisplay({ ...display, nodeSize: value })}
                />
                <Slider
                  label="Link thickness"
                  value={display.edgeSize}
                  min={0.2}
                  max={3}
                  step={0.1}
                  set={(value) => setDisplay({ ...display, edgeSize: value })}
                />
                <Slider
                  label="Label fade threshold"
                  value={display.labels}
                  min={0}
                  max={20}
                  set={(value) => setDisplay({ ...display, labels: value })}
                />
                <label className="graph-check">
                  <input
                    type="checkbox"
                    checked={display.arrows}
                    onChange={(event) => setDisplay({ ...display, arrows: event.target.checked })}
                  />{' '}
                  Direction arrows
                </label>
                <p>Small nodes grow with link count. Labels appear as you zoom or hover.</p>
              </details>
              <details>
                <summary>Forces</summary>
                <Slider
                  label="Center force"
                  value={forces.center}
                  min={0}
                  max={40}
                  set={(value) => setForces({ ...forces, center: value })}
                />
                <Slider
                  label="Repel force"
                  value={forces.repel}
                  min={10}
                  max={800}
                  step={10}
                  set={(value) => setForces({ ...forces, repel: value })}
                />
                <Slider
                  label="Link force"
                  value={forces.link}
                  min={0.01}
                  max={1}
                  step={0.01}
                  set={(value) => setForces({ ...forces, link: value })}
                />
                <Slider
                  label="Link distance"
                  value={forces.distance}
                  min={10}
                  max={200}
                  set={(value) => setForces({ ...forces, distance: value })}
                />
                <button
                  className="subtle-button"
                  onClick={() => {
                    setForces(defaultForces);
                    setDisplay(defaultDisplay);
                  }}
                >
                  <RotateCcw size={13} /> Reset forces and display
                </button>
              </details>
            </aside>
          </div>
          <div className="graph-timeline">
            <div>
              <button
                aria-label={playing ? 'Pause graph timeline' : 'Play graph timeline'}
                disabled={dates.length < 2}
                onClick={() => {
                  if (!playing && (time === null || timeIndex === dates.length - 1)) setTime(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <span>
                Created over time{' '}
                <strong>
                  {dates[timeIndex]?.slice(0, 19).replace('T', ' ') ?? 'No notes yet'}{' '}
                  <small>UTC</small>
                </strong>
              </span>
              <button
                className="subtle-button"
                onClick={() => {
                  setPlaying(false);
                  setTime(null);
                }}
              >
                Show all
              </button>
            </div>
            <input
              aria-label="Graph timeline"
              type="range"
              min={0}
              max={Math.max(0, dates.length - 1)}
              value={Math.max(0, timeIndex)}
              disabled={dates.length < 2}
              onChange={(event) => {
                setPlaying(false);
                setTime(Number(event.target.value));
              }}
            />
          </div>
          <details className="graph-navigator">
            <summary>Note navigator · keyboard and list view</summary>
            <label>
              Find a visible note
              <input
                aria-label="Find graph note"
                value={find}
                onChange={(event) => setFind(event.target.value)}
                maxLength={256}
              />
            </label>
            <div>
              {visibleNodes
                .filter((node) =>
                  `${node.path} ${node.title}`.toLowerCase().includes(find.toLowerCase()),
                )
                .slice(0, 40)
                .map((node) => (
                  <div key={node.id}>
                    <FileText size={13} />
                    <span>{node.path}</span>
                    <button
                      aria-label={`Focus ${node.path} in graph`}
                      onClick={() => {
                        setSelected(node);
                        canvas.current?.focus(node.id);
                      }}
                    >
                      Focus
                    </button>
                    {node.kind === 'note' && (
                      <button
                        aria-label={`Open ${node.path} from navigator`}
                        onClick={() => onOpen(node.id)}
                      >
                        Open
                      </button>
                    )}
                  </div>
                ))}
            </div>
            <p>Showing up to 40 matching nodes. Search here to narrow the list.</p>
          </details>
        </>
      )}
    </section>
  );
}
