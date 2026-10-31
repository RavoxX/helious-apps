import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Folder,
  Monitor,
  PlugZap,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { api, type Session, type User } from './api';
import { useUi } from './store';
import { RowsSkeleton, Skeleton } from './Skeleton';
import './overview.css';

interface SecurityStatus {
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
  pendingApprovals: number;
}
interface Token {
  id: string;
  revokedAt?: string;
  invalidated?: boolean;
  expiresAt: string;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function Tile({
  icon,
  label,
  value,
  detail,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  value: string | undefined;
  detail: string;
  onOpen: () => void;
}) {
  return (
    <button className="overview-tile" onClick={onOpen}>
      <span className="overview-tile-label">
        {icon}
        {label}
      </span>
      {value === undefined ? <Skeleton width={48} height={30} /> : <strong>{value}</strong>}
      <span className="overview-tile-detail">
        {detail} <ArrowRight size={13} aria-hidden="true" />
      </span>
    </button>
  );
}

/** Workspace home: what needs attention, current status and the next setup steps. */
export function Overview({ user }: { user: User }) {
  const { setSection, openVault, requestCreateVault } = useUi();
  const vaults = useQuery({
    queryKey: ['vaults', user.id],
    queryFn: () => api<{ vaults: { id: string; name: string }[] }>('/vaults'),
  });
  const security = useQuery({
    queryKey: ['security-status'],
    queryFn: () => api<SecurityStatus>('/security/status'),
    refetchInterval: 10000,
  });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ sessions: Session[] }>('/auth/sessions'),
  });
  const tokens = useQuery({
    queryKey: ['agent-tokens'],
    queryFn: () => api<{ tokens: Token[] }>('/agents/tokens'),
  });
  const vaultList = vaults.data?.vaults;
  const activeTokens = tokens.data?.tokens.filter(
    (token) => !token.revokedAt && !token.invalidated && new Date(token.expiresAt) > new Date(),
  );
  const status = security.data;
  const failed = [vaults, security, sessions, tokens].some((query) => query.error);

  const steps = [
    {
      label: 'Create your first vault',
      done: !!vaultList?.length,
      action: () => setSection('vaults'),
      cta: 'Create vault',
    },
    {
      label: 'Turn on two-step verification',
      done: !!status?.totpEnabled,
      action: () => setSection('security'),
      cta: 'Set up',
    },
    {
      label: 'Connect an AI tool',
      done: !!activeTokens?.length,
      action: () => setSection('agents'),
      cta: 'Connect',
    },
  ];
  const stepsKnown = vaultList && status && activeTokens;
  const completed = steps.filter((step) => step.done).length;

  const attention: { key: string; text: string; cta: string; go: () => void }[] = [];
  if (status?.pendingApprovals)
    attention.push({
      key: 'approvals',
      text: `${plural(status.pendingApprovals, 'secret request')} waiting for your approval.`,
      cta: 'Review requests',
      go: () => setSection('security'),
    });
  if (status?.totpEnabled && status.recoveryCodesRemaining <= 2)
    attention.push({
      key: 'recovery',
      text: `Only ${plural(status.recoveryCodesRemaining, 'recovery code')} left. Create new codes so you don’t get locked out.`,
      cta: 'Manage codes',
      go: () => setSection('security'),
    });

  return (
    <div className="overview">
      <h1 tabIndex={-1}>Welcome back, {user.name.split(' ')[0]}</h1>
      <p className="page-description">Your workspace at a glance.</p>

      {attention.length > 0 && (
        <section className="overview-attention" aria-labelledby="attention-heading">
          <h2 id="attention-heading">
            <ShieldAlert size={18} aria-hidden="true" /> Needs your attention
          </h2>
          <ul>
            {attention.map((item) => (
              <li key={item.key}>
                <span>{item.text}</span>
                <button className="secondary-button" onClick={item.go}>
                  {item.cta} <ArrowRight size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed && (
        <p role="alert" className="error-message">
          Some workspace details couldn’t be loaded. Check your connection and reload the page.
        </p>
      )}

      <section aria-label="Workspace status" className="overview-tiles">
        <Tile
          icon={<Folder size={16} aria-hidden="true" />}
          label="Vaults"
          value={vaults.error ? '—' : vaultList && String(vaultList.length)}
          detail={vaultList && !vaultList.length ? 'Create a vault' : 'Open vaults'}
          onOpen={() => setSection('vaults')}
        />
        <Tile
          icon={<PlugZap size={16} aria-hidden="true" />}
          label="AI connections"
          value={tokens.error ? '—' : activeTokens && String(activeTokens.length)}
          detail={activeTokens && !activeTokens.length ? 'Connect a tool' : 'Manage connections'}
          onOpen={() => setSection('agents')}
        />
        <Tile
          icon={<ShieldCheck size={16} aria-hidden="true" />}
          label="Two-step verification"
          value={security.error ? '—' : status && (status.totpEnabled ? 'On' : 'Off')}
          detail={status && !status.totpEnabled ? 'Turn it on' : 'Review security'}
          onOpen={() => setSection('security')}
        />
        <Tile
          icon={<Monitor size={16} aria-hidden="true" />}
          label="Signed-in sessions"
          value={sessions.error ? '—' : sessions.data && String(sessions.data.sessions.length)}
          detail="Review sessions"
          onOpen={() => setSection('sessions')}
        />
      </section>

      <div className="overview-columns">
        {stepsKnown && completed < steps.length && (
          <section className="overview-panel" aria-labelledby="setup-heading">
            <div className="overview-panel-head">
              <h2 id="setup-heading">Finish setting up</h2>
              <span>
                {completed} of {steps.length} done
              </span>
            </div>
            <progress value={completed} max={steps.length} aria-label="Setup progress" />
            <ol className="overview-steps">
              {steps.map((step) => (
                <li key={step.label} className={step.done ? 'done' : ''}>
                  <span className="overview-step-mark" aria-hidden="true">
                    {step.done && <Check size={13} />}
                  </span>
                  <span>
                    {step.label}
                    {step.done && <span className="sr-only"> (done)</span>}
                  </span>
                  {!step.done && (
                    <button onClick={step.action}>
                      {step.cta} <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="overview-panel" aria-labelledby="vaults-heading">
          <div className="overview-panel-head">
            <h2 id="vaults-heading">Your vaults</h2>
            {!!vaultList?.length && (
              <button className="overview-text-button" onClick={requestCreateVault}>
                New vault
              </button>
            )}
          </div>
          {vaults.isPending ? (
            <RowsSkeleton label="Loading vaults…" rows={2} />
          ) : vaultList?.length ? (
            <ul className="overview-vaults">
              {vaultList.slice(0, 6).map((vault) => (
                <li key={vault.id}>
                  <button onClick={() => openVault(vault.id)}>
                    <Folder size={16} aria-hidden="true" />
                    <span>{vault.name}</span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="overview-empty">
              <p>
                Vaults hold your notes and files. Create one for a project, a course or everyday
                ideas.
              </p>
              <button className="primary-button" onClick={requestCreateVault}>
                Create your first vault
              </button>
            </div>
          )}
          {vaultList && vaultList.length > 6 && (
            <button className="overview-text-button" onClick={() => setSection('vaults')}>
              Show all {vaultList.length} vaults
            </button>
          )}
        </section>
      </div>

      <nav className="overview-help" aria-label="Help">
        <a href="/docs/editor">
          <BookOpen size={15} aria-hidden="true" /> Workspace guide{' '}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
        <a href="/docs/security">
          <ShieldCheck size={15} aria-hidden="true" /> How your data is protected{' '}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </nav>
    </div>
  );
}
