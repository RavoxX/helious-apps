import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Pin, Columns2, X } from 'lucide-react';
import { api } from './api';
import type { Note } from './VaultLibrary';
import { discardDraft } from './drafts';

interface Layout {
  tabs: string[];
  pinned: string[];
  active: string | null;
  primary: string | null;
  secondary: string | null;
}
function selection(current: Layout, selected: string | null): Layout {
  if (!selected || current.active === selected) return current;
  const next = {
    ...current,
    tabs: current.tabs.includes(selected) ? current.tabs : [...current.tabs, selected],
    active: selected,
  };
  if (selected === current.primary || selected === current.secondary) return next;
  if (current.secondary && current.active === current.secondary) next.secondary = selected;
  else next.primary = selected;
  return next;
}
function load(key: string): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Layout> | null;
    const tabs = Array.isArray(raw?.tabs)
      ? [
          ...new Set(raw.tabs.filter((id) => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id))),
        ].slice(-50)
      : [];
    const active = tabs.includes(raw?.active ?? '') ? raw!.active! : (tabs[0] ?? null);
    const primary = tabs.includes(raw?.primary ?? '') ? raw!.primary! : active;
    const secondary =
      tabs.includes(raw?.secondary ?? '') && raw?.secondary !== primary ? raw!.secondary! : null;
    return {
      tabs,
      active,
      primary,
      secondary,
      pinned: Array.isArray(raw?.pinned) ? raw.pinned.filter((id) => tabs.includes(id)) : [],
    };
  } catch {
    return { tabs: [], pinned: [], active: null, primary: null, secondary: null };
  }
}
function NotePane({
  id,
  vaultId,
  render,
  navigate,
}: {
  id: string;
  vaultId: string;
  render: (note: Note, navigate: (id: string | null) => void) => ReactNode;
  navigate: (id: string | null) => void;
}) {
  const query = useQuery({
    queryKey: ['note', vaultId, id],
    queryFn: () => api<{ note: Note }>(`/vaults/${vaultId}/notes/${id}`),
    refetchOnWindowFocus: false,
  });
  return query.data ? (
    render(query.data.note, navigate)
  ) : query.error ? (
    <p className="error-message" role="alert">
      {query.error.message}
    </p>
  ) : (
    <p className="vault-status" role="status">
      Opening your note…
    </p>
  );
}
export function Notebook({
  vaultId,
  userId,
  selected,
  select,
  notes,
  render,
  create,
}: {
  vaultId: string;
  userId: string;
  selected: string | null;
  select: (id: string | null) => void;
  notes: { id: string; path: string }[];
  render: (note: Note, navigate: (id: string | null) => void) => ReactNode;
  create: () => void;
}) {
  const key = `helious-workspace:${userId}:${vaultId}`;
  const client = useQueryClient();
  const activeNote = useQuery({
    queryKey: ['note', vaultId, selected],
    queryFn: () => api<{ note: Note }>(`/vaults/${vaultId}/notes/${selected}`),
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const [storedLayout, setLayout] = useState(() => load(key));
  const layout = selection(storedLayout, selected);
  const [closing, setClosing] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected && layout.active) select(layout.active);
  }, []);
  useEffect(() => {
    if (!selected) return;
    setLayout((current) => selection(current, selected));
  }, [selected]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(layout));
    } catch {
      /* Layout remains available in memory. */
    }
  }, [key, layout]);
  function split() {
    if (layout.secondary) {
      setLayout({ ...layout, secondary: null, active: layout.primary });
      select(layout.primary);
      return;
    }
    const other =
      layout.tabs.find((id) => id !== layout.primary) ??
      notes.find((note) => note.id !== layout.primary)?.id;
    if (!other || !layout.primary) return;
    setLayout({
      ...layout,
      secondary: other,
      tabs: layout.tabs.includes(other) ? layout.tabs : [...layout.tabs, other],
    });
  }
  useEffect(() => {
    window.addEventListener('helious:split', split);
    return () => window.removeEventListener('helious:split', split);
  }, [layout, notes]);
  function close(id: string, force = false) {
    if (host.current?.querySelector(`[data-note-id="${id}"] [data-dirty="true"]`) && !force) {
      setClosing(id);
      return;
    }
    discardDraft(vaultId, id);
    const tabs = layout.tabs.filter((item) => item !== id);
    let primary = layout.primary;
    let secondary = layout.secondary;
    if (id === primary) primary = tabs.find((item) => item !== secondary) ?? secondary;
    if (id === secondary || primary === secondary) secondary = null;
    const active = selected === id ? primary : selected;
    setLayout({
      tabs,
      primary,
      secondary,
      active,
      pinned: layout.pinned.filter((item) => item !== id),
    });
    setClosing(null);
    select(active);
  }
  const tabs = [...new Set([...layout.tabs, ...(selected ? [selected] : [])])].sort(
    (a, b) => Number(layout.pinned.includes(b)) - Number(layout.pinned.includes(a)),
  );
  return (
    <div className="notebook" ref={host}>
      <div className="notebook-top">
        <div
          className="notebook-tabs"
          role="tablist"
          aria-multiselectable={!!layout.secondary}
          aria-label="Open notes"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'),
            );
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (current < 0) return;
            event.preventDefault();
            const index =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) %
                    buttons.length;
            buttons[index]?.focus();
            select(tabs[index]!);
          }}
        >
          {tabs.map((id) => {
            const title =
              notes.find((note) => note.id === id)?.path ??
              (id === selected ? activeNote.data?.note.path : undefined) ??
              client.getQueryData<{ note: Note }>(['note', vaultId, id])?.note.path ??
              'Note';
            return (
              <div className="notebook-tab" key={id}>
                <button
                  role="tab"
                  tabIndex={selected === id ? 0 : -1}
                  aria-selected={id === layout.primary || id === layout.secondary}
                  aria-controls={`pane-${id}`}
                  id={`tab-${id}`}
                  onClick={() => select(id)}
                >
                  <FileText size={12} />
                  {title.split('/').at(-1)}
                </button>
                <button
                  aria-label={`${layout.pinned.includes(id) ? 'Unpin' : 'Pin'} ${title}`}
                  aria-pressed={layout.pinned.includes(id)}
                  onClick={() =>
                    setLayout((current) => ({
                      ...current,
                      pinned: current.pinned.includes(id)
                        ? current.pinned.filter((item) => item !== id)
                        : [...current.pinned, id],
                    }))
                  }
                >
                  <Pin size={11} />
                </button>
                <button aria-label={`Close ${title}`} onClick={() => close(id)}>
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          className="split-toggle"
          type="button"
          aria-label={layout.secondary ? 'Close split pane' : 'Split pane'}
          aria-pressed={!!layout.secondary}
          disabled={!layout.primary || (tabs.length < 2 && notes.length < 2)}
          onClick={split}
        >
          <Columns2 size={15} />
          <span>{layout.secondary ? 'Unsplit' : 'Split'}</span>
        </button>
      </div>
      {closing && (
        <div className="draft-warning" role="alert">
          <p>This note has unsaved changes. Save it before closing, or discard its draft.</p>
          <button onClick={() => close(closing, true)}>Discard draft and close</button>
          <button onClick={() => setClosing(null)}>Keep editing</button>
        </div>
      )}
      <div className={`notebook-panes ${layout.secondary ? 'is-split' : ''}`}>
        {tabs.map((id) => (
          <div
            key={id}
            id={`pane-${id}`}
            role="tabpanel"
            aria-labelledby={`tab-${id}`}
            className={`notebook-pane ${id === layout.secondary ? 'pane-secondary' : 'pane-primary'} ${id === selected ? 'pane-focused' : ''}`}
            data-note-id={id}
            hidden={id !== layout.primary && id !== layout.secondary}
            onPointerDownCapture={() => {
              if (id !== selected) select(id);
            }}
            onFocusCapture={() => {
              if (id !== selected) select(id);
            }}
          >
            <NotePane
              id={id}
              vaultId={vaultId}
              render={render}
              navigate={(target) => (target ? select(target) : close(id, true))}
            />
          </div>
        ))}
      </div>
      {!layout.primary && (
        <div className="vault-empty">
          <FileText size={36} strokeWidth={1} />
          <h2>{notes.length ? 'Choose a note to get started' : 'Write your first note'}</h2>
          <p>
            {notes.length
              ? 'Open a note from the explorer, or start a new one.'
              : 'Give your note a name, then capture an idea. Use [[links]] to connect it to another note.'}
          </p>
          <button className="secondary-button" onClick={create}>
            {notes.length ? 'New note' : 'Create your first note'}
          </button>
        </div>
      )}
    </div>
  );
}
