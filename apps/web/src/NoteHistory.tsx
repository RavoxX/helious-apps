import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { diffLines } from 'diff';
import { History, RotateCcw, X } from 'lucide-react';
import { api } from './api';
import { refreshVault, spaceQuery, type Space } from './knowledge';
interface Version {
  revision: number;
  path: string;
  spaceId: string;
  action: string;
  actor: { kind: string; id: string };
  recordedAt: string;
}
interface HistoryData {
  versions: Version[];
  total: number;
  currentRevision: number;
  deleted: boolean;
  currentPath: string;
  currentSpaceId: string;
}
export function NoteHistory({
  vaultId,
  noteId,
  spaces,
  dirty = false,
  close,
  restored,
}: {
  vaultId: string;
  noteId: string;
  spaces: Space[];
  dirty?: boolean;
  close: () => void;
  restored?: (id: string) => void;
}) {
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [success, setSuccess] = useState('');
  const history = useQuery({
    queryKey: ['history', vaultId, noteId, offset],
    queryFn: () => api<HistoryData>(`/vaults/${vaultId}/notes/${noteId}/history?offset=${offset}`),
  });
  const selected =
    revision ??
    history.data?.versions.find(
      (version) =>
        version.action !== 'delete' && version.revision !== history.data?.currentRevision,
    )?.revision ??
    history.data?.versions[0]?.revision;
  const version = useQuery({
    queryKey: ['version', vaultId, noteId, selected],
    enabled: selected !== undefined,
    queryFn: () =>
      api<{ version: Version & { markdown: string } }>(
        `/vaults/${vaultId}/notes/${noteId}/history/${selected}`,
      ),
  });
  const current = useQuery({
    queryKey: ['version', vaultId, noteId, history.data?.currentRevision],
    enabled: !!history.data,
    queryFn: () =>
      api<{ version: Version & { markdown: string } }>(
        `/vaults/${vaultId}/notes/${noteId}/history/${history.data!.currentRevision}`,
      ),
  });
  const diff = useMemo(() => {
    if (!version.data || !current.data) return undefined;
    const before = version.data.version.markdown;
    const after = current.data.version.markdown;
    if (
      before.length + after.length > 200000 ||
      before.split('\n').length + after.split('\n').length > 4000
    )
      return null;
    return diffLines(before, after, { maxEditLength: 2000, timeout: 100 }) ?? null;
  }, [version.data, current.data]);
  useEffect(() => {
    setConfirm(false);
  }, [selected, history.data?.currentRevision, dirty]);
  const restore = useMutation({
    mutationFn: () =>
      api<{ revision: number }>(
        `/vaults/${vaultId}/notes/${noteId}/history/${selected}/restore`,
        'POST',
        { revision: history.data!.currentRevision },
      ),
    onSuccess: async (data) => {
      setSuccess(`Restored as revision ${data.revision}.`);
      setConfirm(false);
      setOffset(0);
      setRevision(data.revision);
      await refreshVault(client, vaultId);
      restored?.(noteId);
    },
  });
  const error = history.error ?? version.error ?? current.error ?? restore.error;
  const source = version.data?.version;
  return (
    <section className="note-history" aria-label="Note version history" data-hotkey-editor>
      <header>
        <h3>
          <History size={17} />
          Version history
        </h3>
        <button
          type="button"
          className="subtle-button"
          aria-label="Close version history"
          onClick={close}
        >
          <X size={17} />
        </button>
      </header>
      {history.isPending && <p role="status">Loading saved revisions…</p>}
      {error && (
        <p role="alert" className="error-message">
          {error.message}{' '}
          <button type="button" onClick={() => void refreshVault(client, vaultId)}>
            Refresh history
          </button>
        </p>
      )}
      {history.data && (
        <>
          <p>
            Every save stays in history. Restoring creates a new revision at{' '}
            <strong>{history.data.currentPath}</strong> and returns its content to the saved space.
          </p>
          <label>
            Revision to review
            <select
              aria-label="Revision to review"
              value={selected ?? ''}
              onChange={(event) => {
                setRevision(Number(event.target.value));
                setSuccess('');
              }}
            >
              {history.data.versions.map((item) => (
                <option value={item.revision} key={item.revision}>
                  Revision {item.revision} · {item.action} ·{' '}
                  {new Date(item.recordedAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <div className="history-pagination">
            <span>
              {history.data.total} retained revisions{history.data.deleted ? ' · Note deleted' : ''}
            </span>
            <button
              type="button"
              disabled={!offset}
              onClick={() => {
                setOffset(Math.max(0, offset - 25));
                setRevision(null);
              }}
            >
              Newer
            </button>
            <button
              type="button"
              disabled={offset + history.data.versions.length >= history.data.total}
              onClick={() => {
                setOffset(offset + 25);
                setRevision(null);
              }}
            >
              Older
            </button>
          </div>
          {source && (
            <>
              <p className="history-provenance">
                {source.actor.kind === 'user'
                  ? 'Your account'
                  : source.actor.kind === 'agent'
                    ? `Agent ${source.actor.id}`
                    : 'Migration baseline'}{' '}
                · {spaces.find((space) => space.id === source.spaceId)?.name ?? 'Saved space'} ·{' '}
                {source.path}
              </p>
              {source.path !== history.data.currentPath && (
                <p className="history-notice">
                  This snapshot used a different path. Restoring keeps the current path; review
                  relative links after restoring.
                </p>
              )}
              {diff ? (
                <>
                  <div className="history-diff-label">
                    Selected revision → current saved content · − removed · + added
                  </div>
                  <pre className="history-diff" aria-label="Revision differences" tabIndex={0}>
                    {diff.map((part, index) => (
                      <span
                        key={index}
                        className={
                          part.added
                            ? 'diff-added'
                            : part.removed
                              ? 'diff-removed'
                              : 'diff-unchanged'
                        }
                      >
                        {part.value.split(/(?<=\n)/).map((line, i) => (
                          <span key={i}>
                            {part.added ? '+ ' : part.removed ? '− ' : '  '}
                            {line.replace(/\r?\n$/, '') || ' '}
                          </span>
                        ))}
                      </span>
                    ))}
                  </pre>
                </>
              ) : diff === null ? (
                <p className="history-notice">
                  This comparison is too large for the inline diff. Open the complete saved content
                  below.
                </p>
              ) : (
                <p role="status">Comparing revisions…</p>
              )}
              <details className="history-source">
                <summary>Full saved content</summary>
                <textarea aria-label="Saved revision content" readOnly value={source.markdown} />
              </details>
              {dirty && (
                <p className="history-notice">
                  Save or discard your draft before restoring a revision.
                </p>
              )}
              {!confirm ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    dirty ||
                    source.action === 'delete' ||
                    (source.revision === history.data.currentRevision && !history.data.deleted)
                  }
                  onClick={() => setConfirm(true)}
                >
                  <RotateCcw size={15} />
                  Restore this revision
                </button>
              ) : (
                <div className="history-restore-confirm">
                  <p>
                    Restore revision {source.revision} to{' '}
                    <strong>
                      {spaces.find((space) => space.id === source.spaceId)?.name ??
                        'its original space'}
                    </strong>
                    ? Your current saved content stays in history.
                  </p>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={dirty || restore.isPending}
                    onClick={() => restore.mutate()}
                  >
                    Confirm restore
                  </button>
                  <button type="button" className="subtle-button" onClick={() => setConfirm(false)}>
                    Cancel restore
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {success && <p role="status">{success}</p>}
    </section>
  );
}
export function DeletedNotes({
  vaultId,
  spaceId,
  spaces,
  open,
}: {
  vaultId: string;
  spaceId: string;
  spaces: Space[];
  open: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['deleted-notes', vaultId, spaceId],
    enabled: expanded,
    queryFn: () =>
      api<{ notes: { id: string; path: string; deletedAt: string }[] }>(
        `/vaults/${vaultId}/deleted-notes?${spaceQuery(spaceId)}`,
      ),
  });
  return (
    <details className="deleted-notes" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <History size={15} />
        Deleted notes
      </summary>
      <p>
        Deleted notes stay recoverable until you delete the vault. Select one to review and restore
        a saved revision. Showing the most recent 100.
      </p>
      {query.isPending && expanded && <p role="status">Loading deleted notes…</p>}
      {query.error && (
        <p role="alert" className="error-message">
          {query.error.message}
        </p>
      )}
      {query.data?.notes.length === 0 && <p>No deleted notes in this space.</p>}
      <ul>
        {query.data?.notes.map((note) => (
          <li key={note.id}>
            <button type="button" className="subtle-button" onClick={() => setSelected(note.id)}>
              {note.path}
              <span>{new Date(note.deletedAt).toLocaleDateString()}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <NoteHistory
          key={selected}
          vaultId={vaultId}
          noteId={selected}
          spaces={spaces}
          close={() => setSelected(null)}
          restored={(id) => {
            setSelected(null);
            open(id);
          }}
        />
      )}
    </details>
  );
}
