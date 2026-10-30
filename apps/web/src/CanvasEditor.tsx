import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeVaultPath } from '@helious/core';
import { api } from './api';
import { refreshVault, spaceQuery, type Space } from './knowledge';
import { getCanvasDraft } from './drafts';
import { readWorkspaceFile, saveWorkspaceFile } from './workspace-files';
import { CanvasBoard } from './CanvasSurface';
import { serialize, type NoteLink } from './canvas-model';
import './canvas.css';
export function CanvasManager({
  vaultId,
  spaceId,
  spaces,
  notes,
  openNote,
}: {
  vaultId: string;
  spaceId: string;
  spaces: Space[];
  notes: NoteLink[];
  openNote: (id: string) => void;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState('');
  const [path, setPath] = useState('');
  const [reload, setReload] = useState(0);
  const files = useQuery({
    queryKey: ['attachments', vaultId, spaceId],
    queryFn: () =>
      api<{ attachments: { id: string; path: string }[] }>(
        `/vaults/${vaultId}/attachments?${spaceQuery(spaceId)}`,
      ),
  });
  const canvases = files.data?.attachments.filter((file) => /\.canvas$/i.test(file.path)) ?? [];
  const active = canvases.find((file) => file.path === selected);
  const content = useQuery({
    queryKey: ['canvas-file', vaultId, selected, reload],
    enabled: !!active,
    queryFn: () => readWorkspaceFile(vaultId, active!.id),
    refetchOnWindowFocus: false,
  });
  const create = useMutation({
    mutationFn: async () => {
      const destination =
        spaces.find((space) => space.id === spaceId) ??
        spaces.find((space) => space.kind === 'personal');
      if (!destination) throw new Error('Choose a destination Space first.');
      const target = normalizeVaultPath(/\.canvas$/i.test(path) ? path : `${path}.canvas`);
      const result = await saveWorkspaceFile(
        vaultId,
        target,
        destination.id,
        serialize({ nodes: [], edges: [] }),
        null,
      );
      return result.file;
    },
    onSuccess: async (file) => {
      await refreshVault(client, vaultId);
      setSelected(file.path);
      setPath('');
    },
  });
  return (
    <section className="canvas-manager" aria-label="Canvas workspace">
      <header>
        <div>
          <h2>Canvas</h2>
          <p>
            Map ideas with text, note cards, links and groups. Your boards are portable .canvas
            files.
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label>
            New canvas path
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              maxLength={1024}
              placeholder="Canvas/Project.canvas"
              required
            />
          </label>
          <button disabled={create.isPending || !path.trim()}>Create canvas</button>
        </form>
      </header>
      <label>
        Open canvas
        <select
          aria-label="Open canvas"
          value={active?.path ?? ''}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choose a board</option>
          {canvases.map((file) => (
            <option key={file.id} value={file.path}>
              {file.path}
              {getCanvasDraft(vaultId, file.path) ? ' · unsaved draft' : ''}
            </option>
          ))}
        </select>
      </label>
      {!canvases.length && !files.isPending && (
        <p>No boards yet. Create one in the selected Space, then add your first card.</p>
      )}
      {(create.error || files.error || content.error) && (
        <p role="alert" className="error-message">
          {(create.error ?? files.error ?? content.error)?.message}
        </p>
      )}
      {content.isFetching && active && <p role="status">Opening canvas…</p>}
      {active && content.data && !content.isFetching && (
        <CanvasBoard
          key={`${active.path}:${reload}`}
          vaultId={vaultId}
          file={content.data.file}
          source={content.data.source}
          notes={notes}
          openNote={openNote}
          reload={async () => {
            await client.invalidateQueries({ queryKey: ['attachments', vaultId] });
            setReload((value) => value + 1);
          }}
          onSaved={(file, source) =>
            client.setQueryData(['canvas-file', vaultId, selected, reload], { file, source })
          }
        />
      )}
    </section>
  );
}
