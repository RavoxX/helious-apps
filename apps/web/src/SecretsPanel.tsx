import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { api } from './api';
import type { Space } from './knowledge';
import { useUi } from './store';
import { securityStatus } from './SecurityPanel';
import './security.css';
interface Secret {
  id: string;
  name: string;
  spaceId: string;
  kind: string;
  agentAccess: 'none' | 'read';
  requireApproval: boolean;
  revision: number;
}
export function SecretsPanel({
  vaultId,
  spaceId,
  spaces,
}: {
  vaultId: string;
  spaceId: string;
  spaces: Space[];
}) {
  const client = useQueryClient(),
    status = useQuery(securityStatus()),
    setSection = useUi((s) => s.setSection);
  const base = `/vaults/${vaultId}/secrets`;
  const list = useQuery({
    queryKey: ['secrets', vaultId, spaceId],
    queryFn: () =>
      api<{ secrets: Secret[]; limit: number }>(`${base}${spaceId ? `?spaceId=${spaceId}` : ''}`),
    enabled: status.data?.totpEnabled === true,
  });
  const [editing, setEditing] = useState<Secret | 'new' | null>(null),
    [reveal, setReveal] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [action, setAction] = useState<{ secret: Secret; type: 'reveal' | 'delete' } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    generation = useRef(0),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    const hide = () => {
      generation.current++;
      setReveal(null);
    };
    window.addEventListener('blur', hide);
    const visibility = () => {
      if (document.hidden) hide();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false;
      generation.current++;
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => setReveal(null), 30000);
    return () => clearTimeout(timer);
  }, [reveal]);
  useEffect(() => {
    if (editing || action) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing, action]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (active.current)
        await Promise.all([
          client.invalidateQueries({ queryKey: ['secrets', vaultId] }),
          client.invalidateQueries({ queryKey: ['security-audit'] }),
        ]);
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : 'Unable to complete this action.');
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function copy() {
    if (!reveal) return;
    try {
      const value = reveal.value;
      await navigator.clipboard.writeText(value);
      setNotice(
        'Copied. Helious will try to clear it after 30 seconds if it is still on your clipboard.',
      );
      setTimeout(() => {
        void navigator.clipboard
          .readText()
          .then((current) => {
            if (current === value) return navigator.clipboard.writeText('');
          })
          .catch(() => {
            /* Clipboard access can be restricted by the browser. */
          });
      }, 30000);
    } catch {
      setError('Clipboard access was denied. You can select and copy the revealed value.');
    }
  }
  if (status.isPending) return <p role="status">Checking account protection…</p>;
  if (status.error) return <p role="alert">{status.error.message}</p>;
  if (!status.data?.totpEnabled)
    return (
      <div className="secret-onboarding">
        <ShieldCheck size={30} />
        <h2>A safer place for credentials</h2>
        <p>
          Keep keys and passwords separate from your notes. Enable an authenticator to unlock
          encrypted secrets.
        </p>
        <button className="primary-button" onClick={() => setSection('security')}>
          Set up account protection
        </button>
        <a href="/docs/secrets">How secret access works</a>
      </div>
    );
  const close = () => {
    setEditing(null);
    setAction(null);
  };
  return (
    <div className="secrets-panel">
      <div className="secrets-heading">
        <div>
          <h2>
            <KeyRound size={20} /> Secrets
          </h2>
          <p>Encrypted credentials, separate from notes, search, and your graph.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            setReveal(null);
            setError('');
            setEditing('new');
          }}
        >
          <Plus size={15} /> Add secret
        </button>
      </div>
      {list.isPending && <p role="status">Loading secret metadata…</p>}
      {list.error && (
        <p className="error-message" role="alert">
          {list.error.message}
        </p>
      )}
      {list.data?.secrets.length === 0 && (
        <div className="secret-empty">
          <KeyRound size={26} />
          <h3>No secrets in this space yet</h3>
          <p>
            Add a deploy key or API credential. Each reveal needs your password or an authenticator
            code.
          </p>
        </div>
      )}
      {list.data?.secrets.map((secret) => (
        <article className="secret-row" key={secret.id}>
          <div>
            <h3>{secret.name}</h3>
            <p>
              {spaces.find((s) => s.id === secret.spaceId)?.name} · {secret.kind} ·{' '}
              {secret.agentAccess === 'none'
                ? 'Agents blocked'
                : secret.requireApproval
                  ? 'Agent grant + approval required'
                  : 'Explicit agent grant required'}
            </p>
          </div>
          <div className="security-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setReveal(null);
                setError('');
                setAction({ secret, type: 'reveal' });
              }}
            >
              Reveal
            </button>
            <button
              className="subtle-button"
              onClick={() => {
                setReveal(null);
                setEditing(secret);
              }}
            >
              Edit
            </button>
            <button className="subtle-button" onClick={() => setAction({ secret, type: 'delete' })}>
              Delete
            </button>
          </div>
          {reveal?.id === secret.id && (
            <div className="secret-reveal">
              <p>Visible for up to 30 seconds. Hidden when you leave this window.</p>
              <pre aria-label="Revealed secret">{reveal.value}</pre>
              <div className="security-actions">
                <button className="secondary-button" onClick={() => void copy()}>
                  Copy value
                </button>
                <button className="secondary-button" onClick={() => setReveal(null)}>
                  Hide value
                </button>
              </div>
            </div>
          )}
        </article>
      ))}
      {(list.data?.secrets.length ?? 0) >= 100 && (
        <p>Showing the first 100 secrets. Choose a Space to narrow the list.</p>
      )}
      <p className="security-footnote">
        Create scoped tokens under AI connections in the sidebar. A Space policy alone never grants
        access to a secret. <a href="/docs/secrets">Read the security guide</a>
      </p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <dialog
        ref={dialog}
        className="secret-dialog"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else close();
        }}
        onClose={close}
        aria-labelledby="secret-dialog-title"
      >
        {editing ? (
          <form
            key={typeof editing === 'string' ? editing : editing.id}
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              const data = {
                name: String(values.get('name')),
                kind: String(values.get('kind')),
                spaceId: String(values.get('spaceId')),
                agentAccess: values.has('agentAccess') ? 'read' : 'none',
                requireApproval: values.has('requireApproval'),
                password: String(values.get('password')),
                ...(values.get('value') ? { value: String(values.get('value')) } : {}),
              };
              void run(async () => {
                await api(
                  editing === 'new' ? base : `${base}/${editing.id}`,
                  editing === 'new' ? 'POST' : 'PATCH',
                  { ...data, ...(editing === 'new' ? {} : { revision: editing.revision }) },
                );
                close();
                setNotice('Secret saved.');
              });
            }}
          >
            <h2 id="secret-dialog-title">{editing === 'new' ? 'Add a secret' : 'Edit secret'}</h2>
            <p>Secret values are encrypted on the server. They never become Markdown notes.</p>
            <label>
              Name
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={editing === 'new' ? '' : editing.name}
              />
            </label>
            <div className="secret-form-pair">
              <label>
                Space
                <select
                  name="spaceId"
                  defaultValue={editing === 'new' ? spaceId || spaces[0]?.id : editing.spaceId}
                >
                  {spaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kind
                <select name="kind" defaultValue={editing === 'new' ? 'api-key' : editing.kind}>
                  {['api-key', 'password', 'ssh-key', 'env', 'other'].map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              {editing === 'new'
                ? 'Secret value'
                : 'Replacement value (leave empty to keep current value)'}
              <textarea
                name="value"
                required={editing === 'new'}
                maxLength={65536}
                rows={4}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="security-check">
              <input
                name="agentAccess"
                type="checkbox"
                defaultChecked={editing !== 'new' && editing.agentAccess === 'read'}
              />
              Allow explicitly scoped agent tokens
            </label>
            <label className="security-check">
              <input
                name="requireApproval"
                type="checkbox"
                defaultChecked={editing === 'new' || editing.requireApproval}
              />
              Require approval for each agent access
            </label>
            <label>
              Confirm with your current password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <div className="security-actions">
              <button className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : 'Save secret'}
              </button>
              <button className="secondary-button" type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
            </div>
          </form>
        ) : action ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget),
                ticket = generation.current;
              void run(async () => {
                if (action.type === 'delete') {
                  await api(`${base}/${action.secret.id}`, 'DELETE', {
                    revision: action.secret.revision,
                    password: String(values.get('password')),
                  });
                  setNotice('Secret deleted. Audit records are retained.');
                } else {
                  const result = await api<{ value: string }>(
                    `${base}/${action.secret.id}/access`,
                    'POST',
                    { password: String(values.get('password')) },
                  );
                  if (active.current && generation.current === ticket)
                    setReveal({ id: action.secret.id, value: result.value });
                }
                close();
              });
              e.currentTarget.reset();
            }}
          >
            <h2 id="secret-dialog-title">
              {action.type === 'reveal' ? 'Reveal' : 'Delete'} {action.secret.name}?
            </h2>
            <p>
              {action.type === 'reveal'
                ? 'This access will be recorded. The value hides after 30 seconds.'
                : 'The encrypted value will be removed. This cannot be undone.'}
            </p>
            <label>
              Current password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                maxLength={128}
              />
            </label>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <div className="security-actions">
              <button className="primary-button" disabled={busy}>
                {busy ? 'Verifying…' : action.type === 'reveal' ? 'Reveal secret' : 'Delete secret'}
              </button>
              <button className="secondary-button" type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
