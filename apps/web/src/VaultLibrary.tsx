import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  Download,
  FileText,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  PanelLeft,
  Network,
  ChartNoAxesCombined,
  History,
  KeyRound,
  LayoutDashboard,
} from 'lucide-react';
import { api } from './api';
import { AttachmentLink } from './AttachmentLink';
import { LocalConnections } from './LocalConnections';
const SecretsPanel = lazy(() =>
  import('./SecretsPanel').then((module) => ({ default: module.SecretsPanel })),
);
import { SpacesManager } from './SpacesManager';
import { refreshVault, spaceQuery, type Space } from './knowledge';
const NoteHistory = lazy(() =>
  import('./NoteHistory').then((module) => ({ default: module.NoteHistory })),
);
const DeletedNotes = lazy(() =>
  import('./NoteHistory').then((module) => ({ default: module.DeletedNotes })),
);
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
const MarkdownReading = lazy(() =>
  import('./MarkdownReading').then((module) => ({ default: module.MarkdownReading })),
);
const GraphExplorer = lazy(() =>
  import('./GraphExplorer').then((module) => ({ default: module.GraphExplorer })),
);
const VaultAnalytics = lazy(() =>
  import('./VaultAnalytics').then((module) => ({ default: module.VaultAnalytics })),
);
const CanvasManager = lazy(() =>
  import('./CanvasEditor').then((module) => ({ default: module.CanvasManager })),
);
import { Notebook } from './Notebook';
import { CommandPalette } from './CommandPalette';
import { getDraft, keepDraft, discardDraft } from './drafts';
import { FileTree } from './FileTree';
import { WorkspaceSettings } from './WorkspaceSettings';
import { AuthoringTools } from './AuthoringTools';
import { PropertiesEditor } from './PropertiesEditor';
import { loadPreferences, matchesShortcut, type ShortcutAction } from './preferences';
import './vaults.css';
import './workspace.css';
import './insights.css';
import './spaces.css';

interface Vault {
  id: string;
  name: string;
}
interface NoteSummary {
  spaceId: string;
  id: string;
  path: string;
  title: string;
  tags: string[];
  wordCount: number;
  revision: number;
  updatedAt: string;
}
export interface Note extends NoteSummary {
  markdown: string;
  metadata: {
    properties: Record<string, unknown>;
    headings: { text: string; depth: number; line: number }[];
    blocks: string[];
    warnings: string[];
  };
}
interface LinkData {
  outgoing: {
    target: string;
    fragment: string | null;
    resolution: { noteId: string | null; exists: boolean; fragmentExists: boolean };
  }[];
  backlinks: { id: string; path: string; title: string }[];
  unlinkedMentions: { id: string; path: string; title: string }[];
  mentionsTruncated: boolean;
}
interface Attachment {
  id: string;
  path: string;
  size: number;
}
const message = (error: Error | null) => error?.message ?? '';

function NoteEditor({
  note,
  vaultId,
  openNote,
  notes,
  openGraph,
  spaces,
}: {
  note: Note;
  vaultId: string;
  openNote: (id: string | null) => void;
  notes: NoteSummary[];
  openGraph: () => void;
  spaces: Space[];
}) {
  const client = useQueryClient();
  const [spaceId, setSpaceId] = useState(() => getDraft(vaultId, note.id)?.spaceId ?? note.spaceId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [path, setPath] = useState(() => getDraft(vaultId, note.id)?.path ?? note.path);
  const [markdown, setMarkdown] = useState(
    () => getDraft(vaultId, note.id)?.markdown ?? note.markdown,
  );
  const [revision, setRevision] = useState(
    () => getDraft(vaultId, note.id)?.revision ?? note.revision,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reloadError, setReloadError] = useState('');
  const [mode, setMode] = useState<'Source' | 'Live preview' | 'Reading'>('Source');
  const [linkError, setLinkError] = useState('');
  const editor = useRef<MarkdownEditorHandle>(null);
  const previousServer = useRef(note);
  const [remoteChange, setRemoteChange] = useState(false);
  useEffect(() => {
    const before = previousServer.current;
    if (before.revision === note.revision) return;
    previousServer.current = note;
    if (path === before.path && markdown === before.markdown && spaceId === before.spaceId) {
      setPath(note.path);
      setSpaceId(note.spaceId);
      setMarkdown(note.markdown);
      setRevision(note.revision);
      setRemoteChange(false);
    } else if (revision !== note.revision) setRemoteChange(true);
  }, [note, path, markdown, revision, spaceId]);
  const dirty = path !== note.path || markdown !== note.markdown || spaceId !== note.spaceId;
  useEffect(() => {
    if (dirty) keepDraft(vaultId, note.id, { path, markdown, revision, spaceId });
    else discardDraft(vaultId, note.id);
  }, [dirty, vaultId, note.id, path, markdown, revision, spaceId]);
  const links = useQuery({
    queryKey: ['links', vaultId, note.id, note.revision],
    queryFn: () => api<LinkData>(`/vaults/${vaultId}/notes/${note.id}/links`),
  });
  const save = useMutation({
    mutationFn: () =>
      api<{ note: Note }>(`/vaults/${vaultId}/notes/${note.id}`, 'PATCH', {
        path,
        markdown,
        revision,
        spaceId,
      }),
    onSuccess: async (data) => {
      setRevision(data.note.revision);
      setPath(data.note.path);
      setSpaceId(data.note.spaceId);
      setMarkdown(data.note.markdown);
      setRemoteChange(false);
      setSaved(true);
      client.setQueryData(['note', vaultId, note.id], data);
      await refreshVault(client, vaultId);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/vaults/${vaultId}/notes/${note.id}`, 'DELETE', { revision }),
    onSuccess: () => {
      openNote(null);
      void refreshVault(client, vaultId);
    },
  });
  async function reload() {
    try {
      const data = await api<{ note: Note }>(`/vaults/${vaultId}/notes/${note.id}`);
      setPath(data.note.path);
      setSpaceId(data.note.spaceId);
      setMarkdown(data.note.markdown);
      setRevision(data.note.revision);
      setRemoteChange(false);
      client.setQueryData(['note', vaultId, note.id], data);
      save.reset();
      setReloadError('');
      setSaved(false);
    } catch (error) {
      setReloadError(error instanceof Error ? error.message : 'Unable to reload');
    }
  }
  function openLink(raw: string) {
    const target = raw.split('#')[0] ?? '';
    if (!target) {
      setMode('Source');
      return;
    }
    const withExtension = /\.md$/i.test(target) ? target : `${target}.md`;
    const folder = note.path.includes('/')
      ? note.path.slice(0, note.path.lastIndexOf('/') + 1)
      : '';
    let relative = '';
    try {
      relative = decodeURIComponent(
        new URL(withExtension, `https://vault.invalid/${note.path}`).pathname.slice(1),
      );
    } catch {
      setLinkError('This note link has an invalid path.');
      return;
    }
    const candidates = [folder + withExtension, withExtension, relative].map((item) =>
      item.toLowerCase(),
    );
    const match =
      candidates
        .map((candidate) => notes.find((item) => candidate === item.path.toLowerCase()))
        .find(Boolean) ??
      notes
        .filter(
          (item) => item.path.split('/').at(-1)?.toLowerCase() === withExtension.toLowerCase(),
        )
        .filter((_item, _index, all) => all.length === 1)[0];
    const resolved = links.data?.outgoing.find((link) => link.target === target)?.resolution.noteId;
    if (match || resolved) {
      setLinkError('');
      openNote(resolved ?? match!.id);
    } else setLinkError(`No matching note for “${target}”. Create it or use its full path.`);
  }
  return (
    <section className="note-workspace" aria-label="Markdown note" data-dirty={dirty}>
      <div className="note-edit-top">
        <div>
          <FileText size={16} />
          <span>{mode === 'Reading' ? 'Reading' : 'Markdown'}</span>
        </div>
        <span>{dirty ? 'Unsaved changes' : `Revision ${revision}`}</span>
      </div>
      <div className="editor-toolbar">
        <div role="group" aria-label="Editor view">
          {(['Source', 'Live preview', 'Reading'] as const).map((item) => (
            <button
              type="button"
              data-mode={item}
              key={item}
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="format-tools" role="group" aria-label="Markdown formatting">
          <button
            type="button"
            aria-label="Bold"
            onClick={() => {
              setMode('Source');
              editor.current?.wrap('**', '**');
            }}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            aria-label="Italic"
            onClick={() => {
              setMode('Source');
              editor.current?.wrap('*', '*');
            }}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            aria-label="Insert wikilink"
            onClick={() => {
              setMode('Source');
              editor.current?.wrap('[[', ']]');
            }}
          >
            [[ ]]
          </button>
          <button
            type="button"
            aria-label="Insert task"
            onClick={() => {
              setMode('Source');
              editor.current?.wrap('- [ ] ');
            }}
          >
            ☑
          </button>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="note-path-label">
          Note path
          <input
            name="notePath"
            aria-label="Note path"
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              setSaved(false);
            }}
            required
            maxLength={1024}
          />
        </label>
        <label className="note-space-label">
          Note space
          <select
            aria-label="Note space"
            value={spaceId}
            onChange={(event) => {
              setSpaceId(event.target.value);
              setSaved(false);
            }}
          >
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
          <span>Space changes take effect when you save.</span>
        </label>
        {mode !== 'Reading' && (
          <PropertiesEditor
            value={markdown}
            change={(value) => {
              setMarkdown(value);
              setSaved(false);
            }}
          />
        )}
        <div className={`markdown-surface ${mode === 'Live preview' ? 'markdown-split' : ''}`}>
          <div className="source-pane" hidden={mode === 'Reading'}>
            <span className="editor-caption">Markdown source</span>
            <MarkdownEditor
              ref={editor}
              value={markdown}
              paths={notes.map((item) => item.path)}
              onChange={(value) => {
                setMarkdown(value);
                setSaved(false);
              }}
            />
          </div>
          {mode !== 'Source' && (
            <Suspense fallback={<p className="vault-status">Preparing your preview…</p>}>
              <MarkdownReading
                value={markdown}
                openLink={openLink}
                context={{ vaultId, path: note.path, spaceId: note.spaceId, notes }}
              />
            </Suspense>
          )}
        </div>
        {linkError && (
          <p className="error-message" role="alert">
            {linkError}
          </p>
        )}
        <div className="note-actions">
          <button
            className="primary-button compact-button"
            type="submit"
            disabled={save.isPending || !dirty}
          >
            {save.isPending ? <LoaderCircle size={14} className="spinner" /> : <Save size={14} />}{' '}
            Save note
          </button>
          <button
            className="subtle-button"
            type="button"
            onClick={() => {
              void reload();
            }}
          >
            <RefreshCw size={13} /> {dirty ? 'Discard edits and reload' : 'Reload'}
          </button>
          <button
            type="button"
            className="subtle-button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <History size={14} />
            Version history
          </button>
          <button
            className="subtle-button delete-note"
            type="button"
            onClick={() => setConfirmDelete(!confirmDelete)}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </form>
      <div aria-live="polite">
        {remoteChange && (
          <p className="error-message" role="alert">
            This note changed elsewhere. Your draft is preserved. Copy any changes you need, then
            discard edits and reload before saving.
          </p>
        )}
        {saved && !dirty && (
          <p className="save-confirmation" role="status">
            <Check size={13} /> Note saved
          </p>
        )}
        {(save.error || remove.error || reloadError) && (
          <p className="error-message" role="alert">
            {message(save.error) || message(remove.error) || reloadError}
          </p>
        )}
      </div>
      {confirmDelete && (
        <div className="delete-confirmation">
          <p>Delete this note? You can recover it from Deleted notes until the vault is deleted.</p>
          <button
            className="danger-button"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete this note
          </button>
          <button className="subtle-button" onClick={() => setConfirmDelete(false)}>
            Keep note
          </button>
        </div>
      )}
      {historyOpen && (
        <Suspense fallback={<p role="status">Opening version history…</p>}>
          <NoteHistory
            vaultId={vaultId}
            noteId={note.id}
            spaces={spaces}
            dirty={dirty}
            close={() => setHistoryOpen(false)}
          />
        </Suspense>
      )}
      <div className="note-insights">
        <LocalConnections
          vaultId={vaultId}
          noteId={note.id}
          spaceId={note.spaceId}
          open={openGraph}
        />
        <div>
          <h3>About this note</h3>
          <p>
            {note.wordCount} words · {Math.max(1, Math.ceil(note.wordCount / 200))} min read
          </p>
          <p>
            Last edited{' '}
            <time dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleString()}</time>
          </p>
          {links.data && <p>{links.data.backlinks.length} backlinks</p>}
          <div className="vault-tags">
            {note.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
          {note.metadata.warnings.map((warning) => (
            <p key={warning} className="error-message">
              {warning}
            </p>
          ))}
          {note.metadata.headings.length > 0 && (
            <>
              <h3>Outline</h3>
              <ol>
                {note.metadata.headings.map((heading, index) => (
                  <li key={index}>
                    <button
                      className="outline-jump"
                      type="button"
                      onClick={() => {
                        setMode('Source');
                        requestAnimationFrame(() => editor.current?.line(heading.line));
                      }}
                    >
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <div>
          <h3>
            <Link2 size={13} /> Connections
          </h3>
          <button className="subtle-button" type="button" onClick={openGraph}>
            <Network size={13} /> View local graph
          </button>
          {links.isPending && <p>Resolving links…</p>}
          {links.error && <p role="alert">{links.error.message}</p>}
          {links.data?.outgoing.map((link, index) => (
            <div className="note-connection" key={index}>
              {link.resolution.noteId ? (
                <button onClick={() => openNote(link.resolution.noteId)}>
                  {link.target || note.path}
                  {link.fragment ? `#${link.fragment}` : ''}
                  <ArrowRight size={12} />
                </button>
              ) : (
                <span>Unresolved: {link.target}</span>
              )}
            </div>
          ))}
          <h3>Backlinks</h3>
          {links.data?.backlinks.length === 0 && <p>No linked notes yet.</p>}
          {links.data?.backlinks.map((link) => (
            <button className="backlink-button" key={link.id} onClick={() => openNote(link.id)}>
              <FileText size={12} />
              {link.path}
            </button>
          ))}
          <h3>Unlinked mentions</h3>
          {links.data?.unlinkedMentions.length === 0 && <p>No unlinked text matches yet.</p>}
          {links.data?.unlinkedMentions.map((link) => (
            <button className="backlink-button" key={link.id} onClick={() => openNote(link.id)}>
              <FileText size={12} />
              {link.path}
            </button>
          ))}
          {links.data?.mentionsTruncated && <p>Showing the first 100 text matches.</p>}
        </div>
      </div>
    </section>
  );
}

export function VaultLibrary({
  userId,
  local = false,
  onVaultChange,
}: {
  userId: string;
  local?: boolean;
  onVaultChange?: (id: string | undefined) => void;
}) {
  const client = useQueryClient();
  const [selectedSpace, setSelectedSpace] = useState('');
  const [selectedVault, setSelectedVault] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [vaultName, setVaultName] = useState('');
  const [addingVault, setAddingVault] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [query, setQuery] = useState('');
  const [confirmVaultDelete, setConfirmVaultDelete] = useState(false);
  const [rename, setRename] = useState('');
  const [preferences, setPreferences] = useState(() => loadPreferences(userId));
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [moveError, setMoveError] = useState('');
  const [view, setView] = useState<'notes' | 'graph' | 'analytics' | 'canvas' | 'secrets'>('notes');
  const [graphRoot, setGraphRoot] = useState<string | null>(null);
  const openFromInsights = (id: string) => {
    setSelectedNote(id);
    setView('notes');
  };
  useEffect(() => {
    try {
      localStorage.setItem(`helious-preferences:${userId}`, JSON.stringify(preferences));
    } catch {
      /* Preferences remain available in memory. */
    }
  }, [userId, preferences]);
  const focusNewNote = () => {
    setView('notes');
    setExplorerOpen(true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>('#new-note-path')?.focus(),
    );
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest('[data-hotkey-editor]') ||
        document.querySelector('dialog[open]')
      )
        return;
      const action = (Object.keys(preferences.shortcuts) as ShortcutAction[]).find((item) =>
        matchesShortcut(event, preferences.shortcuts[item]),
      );
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (view !== 'notes' && !['commands', 'switcher', 'create'].includes(action)) return;
      const pane = document.getElementById(`pane-${selectedNote}`);
      if (action === 'save')
        pane?.querySelector<HTMLButtonElement>('.note-actions button[type=submit]')?.click();
      if (action === 'commands' || action === 'switcher')
        window.dispatchEvent(
          new CustomEvent('helious:command', { detail: { quick: action === 'switcher' } }),
        );
      if (action === 'create') focusNewNote();
      if (action === 'reading')
        pane
          ?.querySelector<HTMLButtonElement>(
            pane.querySelector('[data-mode="Reading"][aria-pressed="true"]')
              ? '[data-mode="Source"]'
              : '[data-mode="Reading"]',
          )
          ?.click();
      if (action === 'split') window.dispatchEvent(new Event('helious:split'));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [preferences.shortcuts, selectedNote, view]);
  const vaults = useQuery({
    queryKey: ['vaults', userId],
    queryFn: () => api<{ vaults: Vault[] }>('/vaults'),
  });
  const vault =
    vaults.data?.vaults.find((item) => item.id === selectedVault) ?? vaults.data?.vaults[0];
  const vaultId = vault?.id;
  useEffect(() => onVaultChange?.(vaultId), [vaultId, onVaultChange]);
  const spaces = useQuery({
    queryKey: ['spaces', vaultId],
    enabled: !!vaultId,
    queryFn: () => api<{ spaces: Space[] }>(`/vaults/${vaultId}/spaces`),
  });
  useEffect(() => {
    if (
      selectedSpace &&
      spaces.data &&
      !spaces.data.spaces.some((space) => space.id === selectedSpace)
    )
      setSelectedSpace('');
  }, [spaces.data, selectedSpace]);
  const index = useQuery({
    queryKey: ['notes', vaultId, 'index', selectedSpace],
    enabled: !!vaultId,
    queryFn: async () => {
      const all: NoteSummary[] = [];
      let total = 0;
      do {
        const page = await api<{ notes: NoteSummary[]; total: number }>(
          `/vaults/${vaultId}/notes?limit=100&offset=${all.length}&${spaceQuery(selectedSpace)}`,
        );
        all.push(...page.notes);
        total = page.total;
        if (!page.notes.length) break;
      } while (all.length < total && all.length < 10000);
      return { notes: all, total };
    },
  });
  const notes = useQuery({
    queryKey: ['notes', vaultId, 'search', query, selectedSpace],
    enabled: !!vaultId && !!query,
    queryFn: async () =>
      query
        ? {
            notes: (
              await api<{ results: NoteSummary[] }>(
                `/vaults/${vaultId}/search?q=${encodeURIComponent(query)}&limit=100&${spaceQuery(selectedSpace)}`,
              )
            ).results,
            total: null,
          }
        : api<{ notes: NoteSummary[]; total: number }>(`/vaults/${vaultId}/notes?limit=100`),
  });
  const visibleNotes = query ? (notes.data?.notes ?? []) : (index.data?.notes ?? []);
  async function moveNote(id: string, path: string, revision: number) {
    setMoveError('');
    try {
      if (getDraft(vaultId!, id))
        throw new Error('Save or discard this note’s draft before moving it.');
      await api(`/vaults/${vaultId}/notes/${id}`, 'PATCH', { path, revision });
      await refreshVault(client, vaultId!);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : 'Unable to move note.');
      throw error;
    }
  }
  const files = useQuery({
    queryKey: ['attachments', vaultId, selectedSpace],
    enabled: !!vaultId,
    queryFn: () =>
      api<{ attachments: Attachment[] }>(
        `/vaults/${vaultId}/attachments?${spaceQuery(selectedSpace)}`,
      ),
  });
  const createVault = useMutation({
    mutationFn: () => api<{ vault: Vault }>('/vaults', 'POST', { name: vaultName }),
    onSuccess: async (data) => {
      setSelectedVault(data.vault.id);
      setSelectedSpace('');
      setSelectedNote(null);
      setVaultName('');
      setAddingVault(false);
      await client.invalidateQueries({ queryKey: ['vaults', userId] });
    },
  });
  const renameVault = useMutation({
    mutationFn: () => api(`/vaults/${vaultId}`, 'PATCH', { name: rename }),
    onSuccess: () => {
      setRename('');
      void client.invalidateQueries({ queryKey: ['vaults', userId] });
    },
  });
  const deleteVault = useMutation({
    mutationFn: () => api(`/vaults/${vaultId}`, 'DELETE'),
    onSuccess: () => {
      client.setQueryData<{ vaults: Vault[] }>(['vaults', userId], (data) => ({
        vaults: data?.vaults.filter((item) => item.id !== vaultId) ?? [],
      }));
      setSelectedVault(null);
      setSelectedNote(null);
      setConfirmVaultDelete(false);
      void client.invalidateQueries({ queryKey: ['vaults', userId] });
    },
  });
  const createNote = useMutation({
    mutationFn: () =>
      api<{ note: Note }>(`/vaults/${vaultId}/notes`, 'POST', {
        path: /\.md$/i.test(newPath) ? newPath : `${newPath}.md`,
        markdown: '',
        ...(selectedSpace ? { spaceId: selectedSpace } : {}),
      }),
    onSuccess: (data) => {
      setSelectedNote(data.note.id);
      client.setQueryData(['note', vaultId, data.note.id], data);
      setNewPath('');
      setQuery('');
      setSearchDraft('');
      void refreshVault(client, vaultId!);
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.set('file', file);
      return api(
        `/vaults/${vaultId}/attachments?path=${encodeURIComponent(`Attachments/${file.name}`)}&${spaceQuery(selectedSpace)}`,
        'POST',
        body,
      );
    },
    onSuccess: () => refreshVault(client, vaultId!),
  });
  const removeFile = useMutation({
    mutationFn: (id: string) => api(`/vaults/${vaultId}/attachments/${id}`, 'DELETE'),
    onSuccess: () => refreshVault(client, vaultId!),
  });
  const error =
    createVault.error ??
    createNote.error ??
    upload.error ??
    removeFile.error ??
    renameVault.error ??
    deleteVault.error;
  return (
    <div className="vault-library" data-has-vault={!!vault} data-view={view}>
      <div className="vault-heading" hidden={view !== 'notes' || local}>
        <div>
          <h1>{vault ? 'Your vaults' : 'Create your first vault'}</h1>
          <p className="page-description">
            {vault
              ? 'Write in Notes, explore connections in Graph, and track your progress in Analytics.'
              : 'A vault is a collection of notes and files. Start with one for your projects, learning, or everyday ideas.'}
          </p>
        </div>
        {vault && (
          <button
            className="secondary-button"
            aria-expanded={addingVault}
            aria-controls="create-vault-form"
            onClick={() => {
              setAddingVault(!addingVault);
              if (!addingVault)
                requestAnimationFrame(() => document.getElementById('new-vault-name')?.focus());
            }}
          >
            <Plus size={16} />
            New vault
          </button>
        )}
      </div>
      <form
        id="create-vault-form"
        className="vault-create-form"
        hidden={local || view !== 'notes' || vaults.isPending || (!!vault && !addingVault)}
        onSubmit={(event) => {
          event.preventDefault();
          createVault.mutate();
        }}
      >
        <label>
          Vault name
          <input
            id="new-vault-name"
            aria-label="New vault name"
            value={vaultName}
            onChange={(event) => setVaultName(event.target.value)}
            placeholder="e.g. My knowledge"
            maxLength={100}
            required
          />
        </label>
        <button
          className="secondary-button vault-create-action"
          disabled={createVault.isPending || !vaultName.trim()}
        >
          {createVault.isPending ? (
            <LoaderCircle size={14} className="spinner" />
          ) : (
            <Plus size={14} />
          )}{' '}
          {createVault.isPending ? 'Creating…' : 'Create vault'}
        </button>
        {vault && (
          <button type="button" className="subtle-button" onClick={() => setAddingVault(false)}>
            Cancel
          </button>
        )}
      </form>
      {vaults.isPending && (
        <p role="status" className="vault-status">
          Loading your vaults…
        </p>
      )}
      {vaults.error && (
        <p className="error-message" role="alert">
          {message(vaults.error)}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {message(error)}
        </p>
      )}
      {vaults.data?.vaults.length === 0 && (
        <section className="vault-first-steps" aria-label="Getting started with your vault">
          <h2>From your first note to a bigger picture.</h2>
          <ol>
            <li>
              <FileText size={19} />
              <div>
                <strong>Write a note</strong>
                <p>
                  Capture an idea in plain Markdown. Add [[links]] to connect it to another note.
                </p>
              </div>
            </li>
            <li>
              <Network size={19} />
              <div>
                <strong>Explore your graph</strong>
                <p>See how your saved notes connect. Click a node to open the note.</p>
              </div>
            </li>
            <li>
              <ChartNoAxesCombined size={19} />
              <div>
                <strong>Watch your knowledge grow</strong>
                <p>Analytics shows your notes, links and writing activity in one place.</p>
              </div>
            </li>
          </ol>
          <a href="/docs/editor">
            Read the workspace guide <ArrowRight size={14} />
          </a>
        </section>
      )}
      {vault && (
        <>
          <div className="vault-toolbar">
            <button
              className="secondary-button explorer-toggle"
              type="button"
              aria-expanded={explorerOpen}
              aria-controls="vault-explorer"
              onClick={() => {
                if (view !== 'notes') {
                  setView('notes');
                  setExplorerOpen(true);
                } else setExplorerOpen(!explorerOpen);
              }}
            >
              <PanelLeft size={15} /> Explorer
            </button>
            <label>
              Current vault
              <select
                aria-label="Current vault"
                value={vaultId}
                onChange={(event) => {
                  setSelectedVault(event.target.value);
                  setSelectedSpace('');
                  setSelectedNote(null);
                  setGraphRoot(null);
                  setQuery('');
                  setSearchDraft('');
                  setConfirmVaultDelete(false);
                }}
              >
                {vaults.data?.vaults.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Space
              <select
                aria-label="Space filter"
                value={selectedSpace}
                disabled={!spaces.data}
                onChange={(event) => {
                  setSelectedSpace(event.target.value);
                  setGraphRoot(null);
                  setQuery('');
                  setSearchDraft('');
                }}
              >
                <option value="">All spaces</option>
                {spaces.data?.spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <details className="vault-settings">
              <summary>Vault settings</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  renameVault.mutate();
                }}
              >
                <label>
                  Rename vault
                  <input
                    aria-label="Rename vault"
                    value={rename}
                    onChange={(event) => setRename(event.target.value)}
                    placeholder={vault.name}
                    maxLength={100}
                    required
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={renameVault.isPending || !rename.trim()}
                >
                  Rename
                </button>
              </form>
              <button
                hidden={local}
                className="subtle-button"
                onClick={() => setConfirmVaultDelete(!confirmVaultDelete)}
              >
                <Trash2 size={13} /> Delete vault
              </button>
              {confirmVaultDelete && (
                <div className="delete-confirmation">
                  <p>Delete “{vault.name}” and all its notes and attachments?</p>
                  <button
                    className="danger-button"
                    disabled={deleteVault.isPending}
                    onClick={() => deleteVault.mutate()}
                  >
                    Delete vault and its content
                  </button>
                  <button className="subtle-button" onClick={() => setConfirmVaultDelete(false)}>
                    Keep vault
                  </button>
                </div>
              )}
            </details>
            <CommandPalette
              notes={index.data?.notes ?? []}
              openNote={openFromInsights}
              selected={selectedNote}
              shortcut={preferences.shortcuts.commands}
              create={focusNewNote}
            />
            <WorkspaceSettings value={preferences} save={setPreferences} />
          </div>
          {spaces.error && (
            <p role="alert" className="error-message">
              {spaces.error.message}
            </p>
          )}
          {spaces.data && (
            <div className="vault-management">
              <SpacesManager key={vaultId} vaultId={vaultId!} spaces={spaces.data.spaces} />
              {!local && (
                <AuthoringTools
                  key={`${vaultId}:${selectedSpace}`}
                  vaultId={vaultId!}
                  spaceId={selectedSpace}
                  spaces={spaces.data.spaces}
                  open={openFromInsights}
                />
              )}
              <Suspense fallback={<p>Loading recovery…</p>}>
                <DeletedNotes
                  key={`${vaultId}:${selectedSpace}`}
                  vaultId={vaultId!}
                  spaceId={selectedSpace}
                  spaces={spaces.data.spaces}
                  open={openFromInsights}
                />
              </Suspense>
            </div>
          )}
          <div className="vault-view-tabs" role="tablist" aria-label="Vault views">
            {(local
              ? (['notes', 'graph', 'analytics'] as const)
              : (['notes', 'graph', 'analytics', 'canvas', 'secrets'] as const)
            ).map((item) => {
              const Icon =
                item === 'notes'
                  ? FileText
                  : item === 'graph'
                    ? Network
                    : item === 'secrets'
                      ? KeyRound
                      : item === 'canvas'
                        ? LayoutDashboard
                        : ChartNoAxesCombined;
              return (
                <button
                  key={item}
                  role="tab"
                  id={`vault-tab-${item}`}
                  aria-controls={`vault-view-${item}`}
                  aria-selected={view === item}
                  tabIndex={view === item ? 0 : -1}
                  onClick={() => {
                    if (item === 'graph') setGraphRoot(null);
                    setView(item);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                    event.preventDefault();
                    const items: readonly (
                      'notes' | 'graph' | 'analytics' | 'canvas' | 'secrets'
                    )[] = local
                      ? ['notes', 'graph', 'analytics']
                      : ['notes', 'graph', 'analytics', 'canvas', 'secrets'];
                    const index = items.indexOf(item);
                    const next =
                      items[
                        (index + (event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length
                      ]!;
                    setView(next);
                    requestAnimationFrame(() =>
                      document.getElementById(`vault-tab-${next}`)?.focus(),
                    );
                  }}
                >
                  <Icon size={15} />
                  {item[0]!.toUpperCase() + item.slice(1)}
                </button>
              );
            })}
          </div>
          {view !== 'notes' && (
            <div role="tabpanel" id={`vault-view-${view}`} aria-labelledby={`vault-tab-${view}`}>
              <Suspense
                fallback={
                  <div className="insights-loading" role="status">
                    Opening your {view}…
                  </div>
                }
              >
                {view === 'canvas' ? (
                  <CanvasManager
                    key={`${vaultId}:${selectedSpace}`}
                    vaultId={vaultId!}
                    spaceId={selectedSpace}
                    spaces={spaces.data?.spaces ?? []}
                    notes={index.data?.notes ?? []}
                    openNote={openFromInsights}
                  />
                ) : view === 'secrets' ? (
                  <SecretsPanel
                    key={`${vaultId}:${selectedSpace}`}
                    vaultId={vaultId!}
                    spaceId={selectedSpace}
                    spaces={spaces.data?.spaces ?? []}
                  />
                ) : view === 'graph' ? (
                  <GraphExplorer
                    key={`${vaultId}:${graphRoot}:${selectedSpace}`}
                    userId={userId}
                    vaultId={vaultId!}
                    initialRoot={graphRoot}
                    spaceId={selectedSpace}
                    onOpen={openFromInsights}
                    onNotes={() => setView('notes')}
                  />
                ) : (
                  <VaultAnalytics
                    key={`${vaultId}:${selectedSpace}`}
                    vaultId={vaultId!}
                    spaceId={selectedSpace}
                    onOpen={openFromInsights}
                  />
                )}
              </Suspense>
            </div>
          )}
          <div
            className="vault-editor-view"
            hidden={view !== 'notes'}
            role="tabpanel"
            id="vault-view-notes"
            aria-labelledby="vault-tab-notes"
          >
            <div className={`vault-layout ${explorerOpen ? '' : 'explorer-closed'}`}>
              <aside className="vault-notes" id="vault-explorer" hidden={!explorerOpen}>
                <form
                  className="vault-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setQuery(searchDraft);
                  }}
                >
                  <label htmlFor="vault-query">Search notes</label>
                  <div>
                    <input
                      id="vault-query"
                      value={searchDraft}
                      onChange={(event) => setSearchDraft(event.target.value)}
                      placeholder="Search or tag:project"
                      maxLength={256}
                    />
                    <button aria-label="Search vault">
                      <Search size={15} />
                    </button>
                  </div>
                  {query && (
                    <button
                      className="subtle-button"
                      type="button"
                      onClick={() => {
                        setQuery('');
                        setSearchDraft('');
                      }}
                    >
                      Clear search
                    </button>
                  )}
                </form>
                <form
                  className="note-create-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createNote.mutate();
                  }}
                >
                  <label htmlFor="new-note-path">New note</label>
                  <p className="note-create-space">
                    Create in{' '}
                    {spaces.data?.spaces.find((space) => space.id === selectedSpace)?.name ??
                      'Personal'}
                    .
                  </p>
                  <div>
                    <input
                      id="new-note-path"
                      value={newPath}
                      onChange={(event) => setNewPath(event.target.value)}
                      placeholder="Projects/An idea.md"
                      required
                      maxLength={1024}
                    />
                    <button
                      aria-label="Create note"
                      disabled={createNote.isPending || !newPath.trim()}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </form>
                {(index.isPending || (query && notes.isPending)) && (
                  <p className="vault-status">Loading notes…</p>
                )}
                {(notes.error || index.error) && (
                  <p role="alert" className="error-message">
                    {notes.error?.message ?? index.error?.message}
                  </p>
                )}
                {moveError && (
                  <p role="alert" className="error-message">
                    {moveError}
                  </p>
                )}
                <section className="workspace-bookmarks" aria-label="Bookmarks">
                  <h3>Bookmarks</h3>
                  {(index.data?.notes ?? [])
                    .filter((note) => preferences.bookmarks.includes(note.id))
                    .map((note) => (
                      <button type="button" key={note.id} onClick={() => setSelectedNote(note.id)}>
                        <FileText size={12} />
                        {note.path}
                      </button>
                    ))}
                  {!(index.data?.notes ?? []).some((note) =>
                    preferences.bookmarks.includes(note.id),
                  ) && <p>Star a note to keep it close.</p>}
                </section>
                <FileTree
                  notes={visibleNotes}
                  selected={selectedNote}
                  open={setSelectedNote}
                  move={moveNote}
                  bookmarks={preferences.bookmarks}
                  bookmark={(id) =>
                    setPreferences((current) => ({
                      ...current,
                      bookmarks: current.bookmarks.includes(id)
                        ? current.bookmarks.filter((item) => item !== id)
                        : [...current.bookmarks, id],
                    }))
                  }
                />
                {visibleNotes.length === 0 && (
                  <p className="vault-status">
                    {query ? 'No notes match that search.' : 'No notes yet. Add one above.'}
                  </p>
                )}
                {(query && visibleNotes.length === 100) || (index.data?.total ?? 0) > 10000 ? (
                  <p className="vault-status">
                    {query
                      ? 'Showing up to 100 matches. Refine your search for more specific results.'
                      : 'The explorer shows up to 10,000 notes. Use search to find more.'}
                  </p>
                ) : null}
                <section className="vault-attachments">
                  <h3>Attachments</h3>
                  <label className="upload-button">
                    <Upload size={13} />
                    {upload.isPending ? 'Uploading…' : 'Upload a file'}
                    <input
                      type="file"
                      disabled={upload.isPending}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) upload.mutate(file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  <p>Up to 20 MiB per file.</p>
                  {files.error && <p className="error-message">{files.error.message}</p>}
                  {files.data?.attachments.map((file) => (
                    <div className="attachment-row" key={file.id}>
                      <AttachmentLink vaultId={vaultId!} id={file.id} path={file.path}>
                        <Download size={12} />
                        {file.path.replace(/^Attachments\//, '')}
                      </AttachmentLink>
                      <button
                        aria-label={`Delete attachment ${file.path}`}
                        disabled={removeFile.isPending}
                        onClick={() => removeFile.mutate(file.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </section>
              </aside>
              <div className="vault-note-area">
                <Notebook
                  key={vaultId}
                  userId={userId}
                  vaultId={vaultId!}
                  selected={selectedNote}
                  select={setSelectedNote}
                  notes={index.data?.notes ?? []}
                  create={focusNewNote}
                  render={(note, navigate) => (
                    <NoteEditor
                      note={note}
                      vaultId={vaultId!}
                      openNote={navigate}
                      spaces={spaces.data?.spaces ?? []}
                      notes={index.data?.notes ?? []}
                      openGraph={() => {
                        setGraphRoot(note.id);
                        setView('graph');
                      }}
                    />
                  )}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
