import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, ShieldCheck, Plus } from 'lucide-react';
import { api } from './api';
import { refreshVault, type Space } from './knowledge';

function SpaceRow({ vaultId, space }: { vaultId: string; space: Space }) {
  const client = useQueryClient();
  const [name, setName] = useState(space.name);
  const [revision, setRevision] = useState(space.revision);
  const [access, setAccess] = useState(space.agentAccess);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mutation = useMutation({
    mutationFn: (remove: boolean) =>
      api<{ space?: Space }>(
        `/vaults/${vaultId}/spaces/${space.id}`,
        remove ? 'DELETE' : 'PATCH',
        remove ? {} : { name, agentAccess: access, revision },
      ),
    onSuccess: async (data, remove) => {
      if (data.space) setRevision(data.space.revision);
      setSaved(!remove);
      await client.invalidateQueries({ queryKey: ['spaces', vaultId] });
      await refreshVault(client, vaultId);
    },
  });
  const dirty = name !== space.name || access !== space.agentAccess;
  const confirmPersonal =
    space.kind === 'personal' && access !== 'none' && space.agentAccess === 'none';
  return (
    <form
      className="space-policy-row"
      aria-label={`Space policy for ${space.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(false);
      }}
    >
      <div className="space-policy-identity">
        {space.kind === 'personal' ? <LockKeyhole size={17} /> : <ShieldCheck size={17} />}
        <strong>{space.name}</strong>
        <span>
          {space.kind === 'personal' ? 'Private by default' : 'Explicit token grants required'}
        </span>
      </div>
      {space.kind === 'custom' && (
        <label>
          Space name
          <input
            aria-label={`Name for ${space.name}`}
            value={name}
            maxLength={80}
            required
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />
        </label>
      )}
      <label>
        Agent access cap
        <select
          aria-label={`Agent access for ${space.name}`}
          value={access}
          onChange={(event) => {
            setAccess(event.target.value as Space['agentAccess']);
            setSaved(false);
            setConfirmed(false);
          }}
        >
          <option value="none">No agent access</option>
          <option value="read">Read only, with a token</option>
          <option value="read-write">Read & write, with a token</option>
        </select>
      </label>
      {confirmPersonal && (
        <label className="space-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            required
          />
          I want to make Personal eligible for explicitly scoped agent tokens.
        </label>
      )}
      <div className="space-policy-actions">
        <button
          className="secondary-button"
          disabled={mutation.isPending || !dirty || (confirmPersonal && !confirmed)}
          aria-label={`Save ${space.name} policy`}
        >
          Save policy
        </button>
        {space.kind === 'custom' && (
          <button type="button" className="subtle-button" onClick={() => setDeleting(!deleting)}>
            Delete space
          </button>
        )}
      </div>
      {deleting && (
        <div className="space-delete-confirm">
          <p>Only a space with no notes, attachments or retained history can be deleted.</p>
          <button
            type="button"
            className="danger-button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(true)}
          >
            Delete empty space
          </button>
        </div>
      )}
      {mutation.error && (
        <p role="alert" className="error-message">
          {mutation.error.message}{' '}
          <button
            type="button"
            className="subtle-button"
            onClick={() => void client.invalidateQueries({ queryKey: ['spaces', vaultId] })}
          >
            Refresh spaces
          </button>
        </p>
      )}
      {space.revision > revision && (
        <p className="history-notice">
          This space changed in another view. Your choices are preserved.{' '}
          <button
            type="button"
            className="subtle-button"
            onClick={() => {
              setName(space.name);
              setAccess(space.agentAccess);
              setRevision(space.revision);
              setConfirmed(false);
              setSaved(false);
              mutation.reset();
            }}
          >
            Discard choices and reload space
          </button>
        </p>
      )}
      {saved && <p role="status">Policy saved.</p>}
    </form>
  );
}
export function SpacesManager({ vaultId, spaces }: { vaultId: string; spaces: Space[] }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api(`/vaults/${vaultId}/spaces`, 'POST', { name }),
    onSuccess: () => {
      setName('');
      return client.invalidateQueries({ queryKey: ['spaces', vaultId] });
    },
  });
  return (
    <details className="spaces-manager">
      <summary>
        <ShieldCheck size={15} />
        Spaces & permissions
      </summary>
      <p>
        Spaces organize what you keep private and what agents may access. A policy is a ceiling, not
        a grant: each agent token must also name the vault, space and allowed actions. Manage
        connections in Profile → AI connections.
      </p>
      {spaces.map((space) => (
        <SpaceRow key={space.id} vaultId={vaultId} space={space} />
      ))}
      <form
        className="space-create"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label>
          New space
          <input
            aria-label="New space name"
            placeholder="Client X, Research, Homelab…"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="secondary-button" disabled={!name.trim() || create.isPending}>
          <Plus size={15} />
          Create space
        </button>
      </form>
      {create.error && (
        <p role="alert" className="error-message">
          {create.error.message}
        </p>
      )}
    </details>
  );
}
