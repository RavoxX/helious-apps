import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ShieldCheck, KeyRound, Clock3 } from 'lucide-react';
import { api } from './api';
import './security.css';
export interface SecurityStatus {
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
  pendingApprovals: number;
}
export const securityStatus = () => ({
  queryKey: ['security-status'],
  queryFn: () => api<SecurityStatus>('/security/status'),
  refetchInterval: 10000,
});
interface AuditEvent {
  id: string;
  seq: number;
  at: string;
  action: string;
  outcome: string;
  actor: { id: string; kind: string };
  ip: string;
  secretId?: string;
}
export function SecurityPanel() {
  const client = useQueryClient(),
    status = useQuery(securityStatus());
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null),
    [codes, setCodes] = useState<string[]>([]);
  const [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [before, setBefore] = useState<number | undefined>();
  const audit = useQuery({
    queryKey: ['security-audit', before],
    queryFn: () =>
      api<{ events: AuditEvent[]; nextBefore: number | null }>(
        `/security/audit${before ? `?before=${before}` : ''}`,
      ),
  });
  const inbox = useQuery({
    queryKey: ['secret-approvals'],
    queryFn: () =>
      api<{ approvals: { id: string; agentId: string; secretName: string; expiresAt: string }[] }>(
        '/security/approvals',
      ),
    refetchInterval: 10000,
  });
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['security-status'] }),
        client.invalidateQueries({ queryKey: ['security-audit'] }),
        client.invalidateQueries({ queryKey: ['secret-approvals'] }),
        client.invalidateQueries({ queryKey: ['me'] }),
        client.invalidateQueries({ queryKey: ['sessions'] }),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete this action.');
    } finally {
      setBusy(false);
      setPassword('');
      setCode('');
    }
  }
  // Enrollment material and recovery codes live only in this mounted component.
  useEffect(() => {
    const hide = () => {
      setCodes([]);
    };
    window.addEventListener('blur', hide);
    return () => window.removeEventListener('blur', hide);
  }, []);
  return (
    <div className="security-page">
      <div className="milestone">
        <ShieldCheck size={15} /> Account protection
      </div>
      <h1 tabIndex={-1}>Security & access</h1>
      <p className="page-description">
        Protect your account, review agent requests, and see every secret access.
      </p>
      <section className="security-block" aria-labelledby="two-factor-title">
        <div className="security-block-heading">
          <KeyRound size={20} />
          <div>
            <h2 id="two-factor-title">Two-factor authentication</h2>
            <p>
              {status.data?.totpEnabled
                ? 'Enabled. Your authenticator protects sign-in and your secrets.'
                : 'Add an authenticator before storing secrets. Your notes work without it.'}
            </p>
          </div>
          <span className="security-state">
            {status.isPending ? 'Loading…' : status.data?.totpEnabled ? 'Enabled' : 'Not enabled'}
          </span>
        </div>
        {status.error && <p role="alert">{status.error.message}</p>}
        <form
          className="security-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              if (setup) {
                const result = await api<{ recoveryCodes: string[] }>(
                  '/account/totp/enable',
                  'POST',
                  { code },
                );
                setCodes(result.recoveryCodes);
                setSetup(null);
                setNotice(
                  'Authenticator enabled. Other sessions have been signed out. Save your recovery codes now.',
                );
              } else {
                const result = await api<{ secret: string; uri: string }>(
                  '/account/totp/setup',
                  'POST',
                  { password },
                );
                setSetup({
                  ...result,
                  qr: await QRCode.toDataURL(result.uri, { width: 208, margin: 2 }),
                });
              }
            });
          }}
        >
          {!status.data?.totpEnabled && !setup && (
            <>
              <label>
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  maxLength={128}
                />
              </label>
              <button className="primary-button" disabled={busy || !status.data}>
                Set up authenticator
              </button>
            </>
          )}
          {setup && (
            <div className="totp-enrollment">
              <img
                src={setup.qr}
                width={208}
                height={208}
                alt="Scan this QR code with your authenticator app"
              />
              <div>
                <h3>Scan with your authenticator</h3>
                <p>
                  Use an app such as your password manager or authenticator. Setup expires in 10
                  minutes.
                </p>
                <details>
                  <summary>Enter a setup key instead</summary>
                  <code className="security-key">{setup.secret}</code>
                </details>
                <label>
                  Authenticator code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    maxLength={6}
                  />
                </label>
                <div className="security-actions">
                  <button className="primary-button" disabled={busy}>
                    Enable authenticator
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api('/account/totp/setup', 'DELETE');
                        setSetup(null);
                      })
                    }
                  >
                    Cancel setup
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
        {status.data?.totpEnabled && (
          <>
            <p>
              {status.data.recoveryCodesRemaining} recovery codes remaining. Each code works once.
            </p>
            <details className="security-controls">
              <summary>Recovery codes & authenticator settings</summary>
              <p>
                These actions require your password and an unused authenticator or recovery code.
                Disabling is available after deleting stored secrets.
              </p>
              <label>
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={128}
                />
              </label>
              <label>
                Authenticator or recovery code
                <input
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={128}
                />
              </label>
              <div className="security-actions">
                <button
                  className="secondary-button"
                  disabled={busy || !password || !code}
                  onClick={() =>
                    void act(async () => {
                      const result = await api<{ recoveryCodes: string[] }>(
                        '/account/totp/recovery-codes',
                        'POST',
                        { password, code },
                      );
                      setCodes(result.recoveryCodes);
                      setNotice('Previous recovery codes no longer work. Save these replacements.');
                    })
                  }
                >
                  Replace recovery codes
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !password || !code}
                  onClick={() =>
                    void act(async () => {
                      await api('/account/totp/disable', 'POST', { password, code });
                      setNotice('Authenticator disabled. Other sessions have been signed out.');
                    })
                  }
                >
                  Disable authenticator
                </button>
              </div>
            </details>
          </>
        )}
        {codes.length > 0 && (
          <div className="recovery-codes">
            <h3>Save these recovery codes</h3>
            <p>
              Keep them outside Helious, in a safe place. This view closes when you leave the page
              or window.
            </p>
            <pre>{codes.join('\n')}</pre>
            <button className="secondary-button" onClick={() => setCodes([])}>
              I saved my recovery codes
            </button>
          </div>
        )}
      </section>
      <section className="security-block" aria-labelledby="approvals-title">
        <div className="security-block-heading">
          <Clock3 size={20} />
          <div>
            <h2 id="approvals-title">Agent approval inbox</h2>
            <p>
              Requests expire after 10 minutes and can be redeemed once. Manage agents in Profile →
              AI connections.
            </p>
          </div>
        </div>
        {inbox.isPending && <p role="status">Loading requests…</p>}
        {inbox.error && <p role="alert">{inbox.error.message}</p>}
        {inbox.data?.approvals.length === 0 && <p>No pending requests. You’re all caught up.</p>}
        {inbox.data?.approvals.map((item) => (
          <div className="approval-row" key={item.id}>
            <div>
              <strong>{item.secretName}</strong>
              <p>
                {item.agentId} · expires {new Date(item.expiresAt).toLocaleTimeString()}
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                void act(async () => {
                  await api(`/security/approvals/${item.id}/decision`, 'POST', {
                    approved: true,
                    password: String(values.get('password')),
                  });
                });
                e.currentTarget.reset();
              }}
            >
              <label>
                Confirm with your password
                <input
                  name="password"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
              <button className="primary-button" disabled={busy}>
                Approve once
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api(`/security/approvals/${item.id}/decision`, 'POST', {
                      approved: false,
                    });
                  })
                }
              >
                Deny
              </button>
            </form>
          </div>
        ))}
      </section>
      <section className="security-block" aria-labelledby="audit-title">
        <div className="security-block-heading">
          <ShieldCheck size={20} />
          <div>
            <h2 id="audit-title">Secret audit log</h2>
            <p>
              Access attempts and changes, recorded without secret values. Retained when a vault is
              deleted.
            </p>
          </div>
        </div>
        {audit.isPending && <p role="status">Loading audit log…</p>}
        {audit.error && <p role="alert">{audit.error.message}</p>}
        {audit.data?.events.length === 0 && <p>No security events yet.</p>}
        <div
          className="security-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Audit events; scroll horizontally on smaller screens"
        >
          <table className="security-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Who</th>
                <th>Result</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.events.map((event) => (
                <tr key={event.id}>
                  <td>
                    {event.action}
                    <small>
                      #{event.seq}
                      {event.secretId ? ` · ${event.secretId}` : ''}
                    </small>
                  </td>
                  <td>
                    {event.actor.kind}
                    <small>
                      {event.actor.id} · {event.ip}
                    </small>
                  </td>
                  <td>{event.outcome}</td>
                  <td>{new Date(event.at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="security-actions">
          {before && (
            <button className="secondary-button" onClick={() => setBefore(undefined)}>
              Latest events
            </button>
          )}
          {audit.data?.nextBefore && (
            <button className="secondary-button" onClick={() => setBefore(audit.data!.nextBefore!)}>
              Older events
            </button>
          )}
          <button className="subtle-button" onClick={() => void audit.refetch()}>
            Refresh log
          </button>
        </div>
      </section>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="security-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
