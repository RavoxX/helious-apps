import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PlugZap, Copy, ArrowUpRight, ShieldCheck, Terminal, BookOpen } from 'lucide-react';
import { api } from './api';
import './agents.css';
import './security.css';
export interface ConnectionOptions {
  endpoint: string;
  totpEnabled: boolean;
  vaults: { id: string; name: string }[];
  spaces: { id: string; vaultId: string; name: string; kind: string; agentAccess: string }[];
  secrets: { id: string; name: string; spaceId: string; vaultId: string }[];
}
interface Grants {
  vaultIds: string[];
  spaceIds: string[];
  scopes: string[];
  personalConsent: string[];
}
interface Token {
  id: string;
  name: string;
  kind: string;
  vaultIds: string[];
  spaceIds: string[];
  scopes: string[];
  expiresAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
  invalidated?: boolean;
}
const choices = () => ({
  queryKey: ['agent-options'],
  queryFn: () => api<ConnectionOptions>('/agents/options'),
});
export function GrantChoices({
  options,
  onChange,
  requested,
  emptyState,
}: {
  options: ConnectionOptions;
  onChange: (grants: Grants) => void;
  requested?: string[];
  emptyState?: ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [read, setRead] = useState(!requested || requested.includes('notes:read')),
    [write, setWrite] = useState(false),
    [createSecrets, setCreateSecrets] = useState(false),
    [secrets, setSecrets] = useState<string[]>([]),
    [personal, setPersonal] = useState<string[]>([]);
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  useEffect(() => {
    const spaces = options.spaces.filter((space) => selected.includes(space.id));
    onChange({
      spaceIds: spaces.map((space) => space.id),
      vaultIds: [...new Set(spaces.map((space) => space.vaultId))],
      scopes: [
        ...(read ? ['notes:read'] : []),
        ...(write ? ['notes:write'] : []),
        ...(createSecrets && options.totpEnabled ? ['secrets:create'] : []),
        ...secrets
          .filter((id) =>
            options.secrets.some((secret) => secret.id === id && selected.includes(secret.spaceId)),
          )
          .map((id) => 'secrets:read:' + id),
      ],
      personalConsent: personal.filter((id) => selected.includes(id)),
    });
  }, [selected, read, write, createSecrets, secrets, personal, options, onChange]);
  return (
    <div className="grant-choices">
      <fieldset>
        <legend>What can this connection do?</legend>
        {(!requested || requested.includes('notes:read')) && (
          <label>
            <input
              type="checkbox"
              checked={read}
              onChange={(event) => {
                setRead(event.target.checked);
                if (!event.target.checked) setWrite(false);
              }}
            />
            Read notes and project memory
          </label>
        )}
        {(!requested || requested.includes('notes:write')) && (
          <label>
            <input
              type="checkbox"
              checked={write}
              onChange={(event) => {
                setWrite(event.target.checked);
                if (event.target.checked) setRead(true);
              }}
            />
            Create and update notes, with version history
          </label>
        )}
        {(!requested || requested.includes('secrets:create')) && (
          <label>
            <input
              type="checkbox"
              checked={createSecrets}
              disabled={!options.totpEnabled}
              onChange={(event) => setCreateSecrets(event.target.checked)}
            />
            Store new encrypted secrets (write only)
            <small>
              {options.totpEnabled
                ? 'Requires a writable Space. Reading each secret needs a separate grant.'
                : 'Enable two-factor authentication in Settings before granting this permission.'}
            </small>
          </label>
        )}
      </fieldset>
      <fieldset>
        <legend>Choose the Spaces it may use</legend>
        <p>Only selected Spaces are shared. Personal is never shared automatically.</p>
        {options.vaults.map((vault) => (
          <div className="grant-vault" key={vault.id}>
            <strong>{vault.name}</strong>
            {options.spaces
              .filter((space) => space.vaultId === vault.id)
              .map((space) => (
                <div key={space.id}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={space.agentAccess === 'none'}
                      checked={selected.includes(space.id)}
                      onChange={() => setSelected(toggle(selected, space.id))}
                    />
                    {space.name}
                    <small>
                      {space.agentAccess === 'none'
                        ? 'Agents blocked in Space settings'
                        : space.agentAccess === 'read'
                          ? 'Read only'
                          : 'Read and write eligible'}
                    </small>
                  </label>
                  {selected.includes(space.id) && space.kind === 'personal' && (
                    <label className="personal-confirm">
                      <input
                        type="checkbox"
                        checked={personal.includes(space.id)}
                        onChange={() => setPersonal(toggle(personal, space.id))}
                      />
                      I explicitly want to share this Personal Space.
                    </label>
                  )}
                </div>
              ))}
          </div>
        ))}
        {!options.vaults.length &&
          (emptyState ?? <p>Create a vault first, then return here to connect an agent.</p>)}
      </fieldset>
      <details>
        <summary>Individual secret grants</summary>
        <p>
          Each secret needs its own grant, an eligible Space and two-factor authentication. Its
          approval policy still applies.
        </p>
        {options.secrets
          .filter(
            (secret) =>
              selected.includes(secret.spaceId) &&
              (!requested || requested.includes('secrets:read:' + secret.id)),
          )
          .map((secret) => (
            <label key={secret.id}>
              <input
                type="checkbox"
                checked={secrets.includes(secret.id)}
                onChange={() => setSecrets(toggle(secrets, secret.id))}
              />
              {secret.name}
            </label>
          ))}
        {!options.totpEnabled && (
          <p>Enable an authenticator in Security & access before granting secrets.</p>
        )}
      </details>
    </div>
  );
}
export function AgentConnections() {
  const client = useQueryClient(),
    options = useQuery(choices()),
    tokens = useQuery({
      queryKey: ['agent-tokens'],
      queryFn: () => api<{ tokens: Token[] }>('/agents/tokens'),
    }),
    activity = useQuery({
      queryKey: ['agent-activity'],
      queryFn: () =>
        api<{ events: { id: string; agent: string; action: string; at: string }[] }>(
          '/agents/activity',
        ),
    });
  const [grants, setGrants] = useState<Grants>({
      vaultIds: [],
      spaceIds: [],
      scopes: [],
      personalConsent: [],
    }),
    [creating, setCreating] = useState(false),
    [revealed, setRevealed] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [confirm, setConfirm] = useState<string | null>(null);
  const [tool, setTool] = useState('Codex'),
    [projectVault, setProjectVault] = useState(''),
    [vaultName, setVaultName] = useState('Code workspace'),
    [creatingVault, setCreatingVault] = useState(false);
  const needsPersonalConsent = options.data?.spaces.some(
    (space) =>
      space.kind === 'personal' &&
      grants.spaceIds.includes(space.id) &&
      !grants.personalConsent.includes(space.id),
  );
  const requirement = !options.data?.vaults.length
    ? 'Create a vault and select a Space to enable token creation.'
    : !grants.spaceIds.length
      ? 'Select at least one eligible Space above to enable token creation.'
      : !grants.scopes.length
        ? 'Choose at least one permission above.'
        : needsPersonalConsent
          ? 'Confirm the Personal Space sharing checkbox above before continuing.'
          : '';
  async function createConnectionVault() {
    if (creatingVault || !vaultName.trim()) return;
    setCreatingVault(true);
    setError('');
    try {
      await api('/vaults', 'POST', { name: vaultName.trim() });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['agent-options'] }),
        client.invalidateQueries({ queryKey: ['vaults'] }),
      ]);
      setNotice('Vault created. Select the Code Space to choose what this agent can access.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create the vault.');
    } finally {
      setCreatingVault(false);
    }
  }
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await client.invalidateQueries({ queryKey: ['agent-tokens'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update this connection.');
    } finally {
      setBusy(false);
    }
  }
  const endpoint = options.data?.endpoint ?? window.location.origin + '/mcp';
  const snippet =
    tool === 'Codex'
      ? `[mcp_servers.helious]\nurl = "${endpoint}"\nbearer_token_env_var = "HELIOUS_TOKEN"`
      : tool === 'Claude Code'
        ? `claude mcp add --transport http helious ${endpoint}`
        : `MCP server URL: ${endpoint}\nAuthentication: OAuth\nUse the Helious consent screen to choose Spaces and actions.`;
  return (
    <div className="connections-page">
      <div className="milestone">
        <PlugZap size={15} />
        Your tools, connected
      </div>
      <h1 tabIndex={-1}>AI connections</h1>
      <p className="page-description">
        Give each agent the context it needs. Keep the rest of your workspace private.
      </p>
      <section className="connection-section">
        <div className="connection-section-head">
          <div>
            <h2>Connected agents</h2>
            <p>
              Revoking a connection blocks future requests and writes. Password or authenticator
              changes require reconnecting.
            </p>
          </div>
          <button
            className="primary-button"
            onClick={() => {
              setCreating(!creating);
              setRevealed('');
              setError('');
            }}
          >
            {creating ? 'Close form' : 'Create agent token'}
          </button>
        </div>
        {creating && options.data && (
          <form
            className="connection-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || creatingVault || requirement) return;
              const data = new FormData(event.currentTarget);
              void act(async () => {
                const result = await api<{ token: string }>('/agents/tokens', 'POST', {
                  ...grants,
                  name: String(data.get('name')),
                  expiresInDays: Number(data.get('days')),
                  password: String(data.get('password')),
                });
                setRevealed(result.token);
                setCreating(false);
              });
              event.currentTarget.querySelector<HTMLInputElement>('[name=password]')!.value = '';
            }}
          >
            <div className="connection-pair">
              <label>
                Connection name
                <input name="name" placeholder="Codex · my project" required maxLength={80} />
              </label>
              <label>
                Expires after
                <select name="days" defaultValue="30">
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </select>
              </label>
            </div>
            <GrantChoices
              options={options.data}
              onChange={setGrants}
              emptyState={
                <div className="agent-vault-setup">
                  <h3>Create a vault to connect your agent</h3>
                  <p>
                    A vault stores your notes. It starts with Code and Personal Spaces. Nothing is
                    shared until you select an eligible Space.
                  </p>
                  <label htmlFor="agent-vault-name">New vault name</label>
                  <input
                    id="agent-vault-name"
                    value={vaultName}
                    maxLength={100}
                    disabled={creatingVault}
                    onChange={(event) => setVaultName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void createConnectionVault();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={creatingVault || !vaultName.trim()}
                    onClick={() => void createConnectionVault()}
                  >
                    {creatingVault ? 'Creating vault…' : 'Create vault and continue'}
                  </button>
                </div>
              }
            />
            <label>
              Confirm with your current password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                maxLength={128}
              />
            </label>
            <button
              className="primary-button"
              disabled={busy || creatingVault || !!requirement}
              aria-describedby={requirement ? 'agent-token-requirement' : undefined}
            >
              {busy ? 'Creating…' : 'Create token with these permissions'}
            </button>
            {requirement && (
              <p id="agent-token-requirement" role="status">
                {requirement}
              </p>
            )}
          </form>
        )}
        {options.error && <p role="alert">{options.error.message}</p>}
        {tokens.error && <p role="alert">{tokens.error.message}</p>}
        {tokens.isPending && <p role="status">Loading connections…</p>}
        {revealed && (
          <div className="one-time-token">
            <h3>Save this token now</h3>
            <p>
              It will not be shown again. Store it in your password manager or the HELIOUS_TOKEN
              environment variable. Do not commit it to a repository.
            </p>
            <code>{revealed}</code>
            <div className="security-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(revealed)
                    .then(() => setNotice('Token copied. Store it securely.'))
                    .catch(() =>
                      setError('Clipboard access was denied. Select the token to copy it.'),
                    )
                }
              >
                <Copy size={14} />
                Copy token
              </button>
              <button className="secondary-button" onClick={() => setRevealed('')}>
                I saved my token
              </button>
            </div>
          </div>
        )}
        {!tokens.isPending &&
          !tokens.data?.tokens.some((token) => !token.revokedAt) &&
          !creating && (
            <div className="connection-empty">
              <Terminal size={25} />
              <h3>Your next agent can start with context.</h3>
              <p>
                Create a token for a local coding agent, or connect through OAuth from a remote AI
                tool. You choose the permissions each time.
              </p>
            </div>
          )}
        {tokens.data?.tokens
          .filter((token) => !token.revokedAt)
          .map((token) => (
            <article className="connection-row" key={token.id}>
              <div>
                <h3>{token.name}</h3>
                <p>
                  {token.kind === 'oauth' ? 'OAuth connection' : 'Personal agent token'} ·{' '}
                  {token.revokedAt
                    ? 'Revoked'
                    : token.invalidated
                      ? 'Reconnect required'
                      : new Date(token.expiresAt) <= new Date()
                        ? 'Expired'
                        : `Expires ${new Date(token.expiresAt).toLocaleDateString()}`}
                </p>
                <p>
                  {token.spaceIds
                    .map(
                      (id) =>
                        options.data?.spaces.find((space) => space.id === id)?.name ??
                        'Unavailable Space',
                    )
                    .join(' · ')}{' '}
                  ·{' '}
                  {token.scopes
                    .map((scope) =>
                      scope === 'secrets:create'
                        ? 'Store encrypted secrets'
                        : scope.startsWith('secrets:')
                          ? 'one secret'
                          : scope,
                    )
                    .join(', ')}
                </p>
                <small>
                  {token.lastUsedAt
                    ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                    : 'Not used yet'}
                </small>
              </div>
              {!token.revokedAt &&
                (confirm === token.id ? (
                  <div className="security-actions">
                    <span>Disconnect this agent?</span>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api(`/agents/tokens/${token.id}`, 'DELETE');
                          setConfirm(null);
                          setNotice('Connection revoked.');
                        })
                      }
                    >
                      Confirm revoke
                    </button>
                    <button className="subtle-button" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button className="secondary-button" onClick={() => setConfirm(token.id)}>
                    Revoke
                  </button>
                ))}
            </article>
          ))}
      </section>
      <section className="connection-section">
        <h2>Connect your AI tool</h2>
        <p>
          Use a personal token for local agents, or approve an OAuth connection from a remote tool.
          The endpoint is <code>{endpoint}</code>.
        </p>
        <label className="tool-select">
          Your tool
          <select value={tool} onChange={(event) => setTool(event.target.value)}>
            {['Codex', 'Claude Code', 'Claude.ai', 'ChatGPT'].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <pre className="connection-config">{snippet}</pre>
        <p>
          {tool === 'Codex'
            ? 'Add this to your Codex MCP configuration and set HELIOUS_TOKEN in the environment. OAuth is also supported with codex mcp login helious.'
            : tool === 'Claude Code'
              ? 'Run the command, then use /mcp to authenticate through OAuth. A stdio bridge is also available for token-based setups.'
              : 'Your Helious instance must be reachable over HTTPS from the remote service. localhost is for local agents only. Availability depends on your AI account and workspace settings.'}
        </p>
        <a href="/docs/mcp">
          <BookOpen size={14} />
          Complete connection guide
          <ArrowUpRight size={13} />
        </a>
      </section>
      <section className="connection-section">
        <h2>Start a project memory</h2>
        <p>
          Create Overview, Architecture, an ADR draft, Runbook and Agent Log notes in the Code
          Space. Existing paths are never overwritten.
        </p>
        <form
          className="project-memory-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget),
              space = options.data?.spaces.find(
                (space) => space.vaultId === projectVault && space.kind === 'code',
              );
            if (!space) return;
            void act(async () => {
              await api(`/vaults/${projectVault}/project-template`, 'POST', {
                spaceId: space.id,
                project: String(form.get('project')),
              });
              await client.invalidateQueries({ queryKey: ['notes', projectVault] });
              setNotice('Project memory created in your Code Space.');
            });
          }}
        >
          <label>
            Vault
            <select
              required
              value={projectVault}
              onChange={(event) => setProjectVault(event.target.value)}
            >
              <option value="">Choose a vault</option>
              {options.data?.vaults.map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project name
            <input name="project" required maxLength={80} placeholder="my-project" />
          </label>
          <button className="secondary-button" disabled={busy || !projectVault}>
            Create project memory
          </button>
        </form>
      </section>
      <section className="connection-section">
        <h2>Recent agent activity</h2>
        <p>Note reads and writes are recorded without note bodies. Retained for 90 days.</p>
        {activity.data?.events.length ? (
          <ul className="agent-events">
            {activity.data.events.slice(0, 20).map((event) => (
              <li key={event.id}>
                <span>
                  {event.agent} · {event.action}
                </span>
                <time>{new Date(event.at).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p>No activity yet. It will appear when an agent uses Helious.</p>
        )}
        {activity.error && <p role="alert">{activity.error.message}</p>}
      </section>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="security-notice">
          {notice}
        </p>
      )}
      <p className="connection-footnote">
        <ShieldCheck size={14} />
        Sharing context is a choice. Review notes before granting access and keep credentials in
        Secrets.
      </p>
    </div>
  );
}
export function OAuthConsent() {
  const raw = new URLSearchParams(location.search).get('request') ?? '',
    options = useQuery(choices()),
    request = useQuery({
      queryKey: ['oauth-request', raw],
      queryFn: () =>
        api<{ clientName: string; redirectUri: string; scopes: string[]; expiresAt: string }>(
          `/oauth/requests/${encodeURIComponent(raw)}`,
        ),
      retry: false,
    });
  const [grants, setGrants] = useState<Grants>({
      vaultIds: [],
      spaceIds: [],
      scopes: [],
      personalConsent: [],
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function decide(approved: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ redirect: string }>('/oauth/consent', 'POST', {
        request: raw,
        approved,
        ...(approved ? grants : {}),
      });
      location.assign(result.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to finish this connection.');
      setBusy(false);
    }
  }
  return (
    <main className="oauth-consent">
      <a className="brand" href="/app/">
        <img src="/app/helious-logo.png" width={32} height={32} alt="" />
        helious.
      </a>
      <h1>Connect {request.data?.clientName ?? 'your AI tool'}</h1>
      <p>Choose the context this application may use. You can revoke the connection at any time.</p>
      {request.data && (
        <div className="oauth-destination">
          <strong>Return address</strong>
          <code>{new URL(request.data.redirectUri).origin}</code>
          <small>
            Client names are supplied by the application. Confirm that you trust this destination.
          </small>
        </div>
      )}
      {request.isPending && <p role="status">Checking connection request…</p>}
      {request.error && (
        <p className="error-message" role="alert">
          {request.error.message}
        </p>
      )}
      {options.data && request.data && (
        <GrantChoices options={options.data} requested={request.data.scopes} onChange={setGrants} />
      )}
      {options.error && <p role="alert">{options.error.message}</p>}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="security-actions">
        <button
          className="primary-button"
          disabled={busy || !request.data || !grants.spaceIds.length || !grants.scopes.length}
          onClick={() => void decide(true)}
        >
          {busy ? 'Connecting…' : 'Allow selected access'}
        </button>
        <button
          className="secondary-button"
          disabled={busy || !request.data}
          onClick={() => void decide(false)}
        >
          Deny connection
        </button>
        <a href="/app/">Return to workspace</a>
      </div>
    </main>
  );
}
