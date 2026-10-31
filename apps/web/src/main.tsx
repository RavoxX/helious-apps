import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  useLocation,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  House,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  LockKeyhole,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  PlugZap,
  Sun,
  Trash2,
} from 'lucide-react';
import '@fontsource-variable/manrope';
import { api, ApiError, type Session, type User } from './api';
import {
  bindSectionNavigation,
  replaceVaultUrl,
  sectionForPath,
  sectionPaths,
  useUi,
  type Section,
} from './store';
import { PageSkeleton, RowsSkeleton, ShellSkeleton, Skeleton } from './Skeleton';
import { useTheme } from './theme';
import { ProfileMenu } from './ProfileMenu';
const VaultLibrary = lazy(() =>
  import('./VaultLibrary').then((module) => ({ default: module.VaultLibrary })),
);
const SecurityPanel = lazy(() =>
  import('./SecurityPanel').then((module) => ({ default: module.SecurityPanel })),
);
const AgentConnections = lazy(() =>
  import('./AgentConnections').then((module) => ({ default: module.AgentConnections })),
);
const Overview = lazy(() => import('./Overview').then((module) => ({ default: module.Overview })));
const OAuthConsent = lazy(() =>
  import('./AgentConnections').then((module) => ({ default: module.OAuthConsent })),
);
import { EmailFlow, ResendVerification, ChangeEmail } from './EmailFlow';
import { AccountData } from './AccountData';
import './style.css';
import './auth.css';
import './dashboard.css';
import './sidebar.css';

function Brand() {
  return (
    <a className="brand" href="/">
      <img src="/app/helious-logo.png" width="35" height="35" alt="" />
      helious<span>.</span>
    </a>
  );
}
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="app-theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
const errorText = (error: Error | null) =>
  error instanceof ApiError
    ? error.message
    : error
      ? 'Cannot reach your Helious server. Check the connection and try again.'
      : '';

function Auth({ mode }: { mode: 'register' | 'login' }) {
  const navigate = useNavigate();
  const [pendingEmail, setPendingEmail] = useState('');
  const [address, setAddress] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const client = useQueryClient();
  const registration = useQuery({
    queryKey: ['registration'],
    queryFn: () =>
      api<{
        registrationOpen: boolean;
        minimumAge: number;
        terms: { version: string; url: string } | null;
        privacyUrl: string | null;
      }>('/auth/config'),
  });
  const isRegister = mode === 'register' && registration.data?.registrationOpen !== false;
  const mutation = useMutation({
    mutationFn: (data: {
      email: string;
      password: string;
      name?: string;
      code?: string;
      ageConfirmed?: boolean;
      termsAccepted?: boolean;
      termsVersion?: string;
    }) =>
      api<{ user?: User; verificationRequired?: boolean }>(
        `/auth/${isRegister ? 'register' : 'login'}`,
        'POST',
        data,
      ),
    onSuccess: (data, input) => {
      if (data.verificationRequired) setPendingEmail(input.email);
      else if (data.user) client.setQueryData(['me'], data);
    },
  });
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const email = String(values.get('email') ?? '').trim();
    const password = String(values.get('password') ?? '');
    mutation.mutate({
      email,
      password,
      ...(!isRegister && values.get('code') ? { code: String(values.get('code')).trim() } : {}),
      ...(isRegister ? { name: String(values.get('name') ?? '').trim() } : {}),
      ...(isRegister && registration.data?.minimumAge
        ? { ageConfirmed: values.get('ageConfirmed') === 'on' }
        : {}),
      ...(isRegister && registration.data?.terms
        ? {
            termsAccepted: values.get('termsAccepted') === 'on',
            termsVersion: registration.data.terms.version,
          }
        : {}),
    });
  };
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand />
        <div>
          <a href="/" className="back-link">
            <ArrowLeft size={14} /> Back to homepage
          </a>
          <ThemeToggle />
        </div>
      </header>
      <div className="auth-layout">
        <aside className="auth-intro">
          <div>
            <span className="intro-line">
              <span /> A home for connected thinking
            </span>
            <h1>
              A little space.
              <br />A clearer mind.
            </h1>
            <p>
              For the ideas you’re working on.
              <br />
              And the ones you haven’t connected yet.
            </p>
          </div>
          <p className="intro-bottom">
            <ShieldCheck size={15} /> Your knowledge. Your choices. Your space.
          </p>
        </aside>
        <main className="auth-main">
          <div className="auth-form-wrap">
            <div className="milestone">A space of your own</div>
            <h2>
              {pendingEmail
                ? 'Check your inbox.'
                : isRegister
                  ? 'Make yourself at home.'
                  : 'Good to have you back.'}
            </h2>
            {new URLSearchParams(window.location.search).has('verified') && (
              <p role="status">Email verified. You can now sign in.</p>
            )}
            {new URLSearchParams(window.location.search).has('reset') && (
              <p role="status">Password changed. Sign in with your new password.</p>
            )}
            {new URLSearchParams(window.location.search).has('deleted') && (
              <p role="status">
                Your account is closed and permanent erasure is queued. Your sessions and agent
                access have ended.
              </p>
            )}
            {pendingEmail && (
              <div className="verification-notice">
                <p role="status">
                  Please verify your email. We sent a 30-minute link to {pendingEmail}.
                </p>
                <ResendVerification email={pendingEmail} />
                <a href="/login">Back to sign in</a>
              </div>
            )}
            <p>
              {isRegister
                ? 'Create your Helious account and make yourself at home.'
                : 'Sign in to your private workspace.'}
            </p>
            {registration.data?.registrationOpen === false && (
              <p className="notice">
                Registration is closed on this server. Sign in with an existing account.
              </p>
            )}
            <form hidden={!!pendingEmail} onSubmit={submit} key={isRegister ? 'register' : 'login'}>
              {isRegister && (
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={80}
                    placeholder="Your name"
                  />
                </label>
              )}
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder="you@example.com"
                  onChange={(event) => setAddress(event.target.value)}
                />
              </label>
              <label>
                Password
                <div className="password-input">
                  <input
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    required
                    minLength={12}
                    maxLength={128}
                    placeholder={isRegister ? 'At least 12 characters' : 'Your password'}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
              {!isRegister &&
                mutation.error instanceof ApiError &&
                ['TOTP_REQUIRED', 'TOTP_INVALID'].includes(mutation.error.code ?? '') && (
                  <label>
                    Authenticator or recovery code
                    <input name="code" autoComplete="one-time-code" required maxLength={128} />
                  </label>
                )}
              {isRegister && (
                <p className="field-hint">
                  Use 12–128 characters. A few memorable words work well.
                </p>
              )}
              <div aria-live="polite">
                {isRegister && !!registration.data?.minimumAge && (
                  <label className="policy-checkbox">
                    <input type="checkbox" name="ageConfirmed" required />{' '}
                    <span>
                      I confirm that I am at least {registration.data.minimumAge} years old.
                    </span>
                  </label>
                )}
                {isRegister && registration.data?.terms && (
                  <label className="policy-checkbox">
                    <input type="checkbox" name="termsAccepted" required />{' '}
                    <span>
                      I agree to the{' '}
                      <a href={registration.data.terms.url} target="_blank" rel="noreferrer">
                        Terms of Service
                      </a>
                      .
                    </span>
                  </label>
                )}
                {isRegister && registration.data?.privacyUrl && (
                  <p className="field-hint">
                    See how this instance handles your data in its{' '}
                    <a href={registration.data.privacyUrl} target="_blank" rel="noreferrer">
                      Privacy Policy
                    </a>
                    .
                  </p>
                )}
                {mutation.error && (
                  <p role="alert" className="error-message">
                    {errorText(mutation.error)}
                  </p>
                )}
                {registration.error && (
                  <p role="alert" className="error-message">
                    {errorText(registration.error)}
                  </p>
                )}
              </div>
              <button
                className="primary-button"
                type="submit"
                disabled={mutation.isPending || registration.isPending || !!registration.error}
              >
                {mutation.isPending ? (
                  <>
                    <LoaderCircle className="spinner" size={16} />{' '}
                    {isRegister ? 'Creating your account…' : 'Signing you in…'}
                  </>
                ) : (
                  <>
                    {isRegister ? 'Create your account' : 'Sign in'}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
            {!isRegister && !pendingEmail && (
              <a className="auth-forgot" href="/forgot-password">
                Forgot password?
              </a>
            )}
            {mutation.error instanceof ApiError &&
              ['EMAIL_UNVERIFIED', 'EMAIL_DELIVERY_FAILED'].includes(mutation.error.code ?? '') && (
                <ResendVerification email={address} />
              )}
            {registration.data?.registrationOpen !== false && (
              <p className="auth-switch">
                {isRegister ? 'Already have an account?' : 'New to this server?'}{' '}
                <button
                  onClick={() => {
                    void navigate({ to: isRegister ? '/login' : '/register' });
                    setPendingEmail('');
                    mutation.reset();
                  }}
                >
                  {isRegister ? 'Sign in' : 'Create an account'}
                </button>
              </p>
            )}
            <div className="auth-privacy">
              <LockKeyhole size={15} />
              <p>
                Verified email. No trackers.
                <br />
                Your account is the start of your space.
              </p>
            </div>
          </div>
          <a className="help-link" href="/docs/getting-started">
            Setting up your own server? Read the guide <ArrowUpRight size={12} />
          </a>
        </main>
      </div>
    </div>
  );
}

// Readable "Browser on OS" label; the full user-agent string stays in the row's title.
const browsers: [RegExp, string][] = [
  [/Helious/i, 'Helious app'],
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const systems: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Android/, 'Android'],
  [/Linux/, 'Linux'],
];
function describeAgent(agent: string) {
  const match = (list: [RegExp, string][]) => list.find(([pattern]) => pattern.test(agent))?.[1];
  const browser = match(browsers) ?? 'Unknown browser',
    system = match(systems);
  return system ? `${browser} on ${system}` : browser;
}

function Sessions() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ sessions: Session[] }>('/auth/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (session: Session) => api(`/auth/sessions/${session.id}`, 'DELETE'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['sessions'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
  return (
    <>
      <h1 tabIndex={-1}>Your active sessions</h1>
      <p className="page-description">
        These are the browsers and apps signed in to your account. If you don’t recognise one,
        revoke it to end its access immediately.
      </p>
      {query.isPending && <RowsSkeleton label="Loading sessions…" />}
      {query.error && (
        <p role="alert" className="error-message">
          {errorText(query.error)}
        </p>
      )}
      {revoke.error && (
        <p role="alert" className="error-message">
          {errorText(revoke.error)}
        </p>
      )}
      <div className="session-list">
        {query.data?.sessions.map((session) => (
          <div className="session-row" key={session.id}>
            <Monitor size={24} aria-hidden="true" />
            <div>
              <strong>{session.current ? 'This browser' : describeAgent(session.userAgent)}</strong>
              <p className="user-agent" title={session.userAgent}>
                {session.current ? describeAgent(session.userAgent) : 'Browser session'}
              </p>
              <small>
                Signed in {new Date(session.createdAt).toLocaleString()} · Expires{' '}
                {new Date(session.expiresAt).toLocaleDateString()}
              </small>
            </div>
            {session.current ? (
              <span className="current-session">
                <Check size={12} /> Current
              </span>
            ) : (
              <button
                className="danger-button"
                disabled={revoke.isPending}
                aria-label={`Revoke ${describeAgent(session.userAgent)} session`}
                onClick={() => revoke.mutate(session)}
              >
                <Trash2 size={15} /> Revoke
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function AdminSettings({ user }: { user: User }) {
  const { theme, toggle } = useTheme();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['registration'],
    queryFn: () => api<{ registrationOpen: boolean }>('/auth/config'),
  });
  const mutation = useMutation({
    mutationFn: (open: boolean) => api('/admin/registration', 'PUT', { open }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['registration'] }),
  });
  return (
    <>
      <h1 tabIndex={-1}>Account settings</h1>
      <p className="page-description">Manage your email, appearance and account access.</p>
      <dl className="account-details">
        <div>
          <dt>Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{user.role}</dd>
        </div>
      </dl>
      <ChangeEmail currentEmail={user.email} pendingEmail={user.pendingEmail} />
      <AccountData user={user} />
      <section className="account-appearance" aria-labelledby="appearance-heading">
        <div>
          <h2 id="appearance-heading">Appearance</h2>
          <p>Choose how Helious looks in this browser.</p>
        </div>
        <button className="secondary-button" onClick={toggle}>
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          {theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
        </button>
      </section>
      <p className="account-help">
        Need a new password? <a href="/forgot-password">Request a password reset email</a>.
      </p>
      {user.role === 'admin' && (
        <div className="registration-setting">
          <h2>Account registration</h2>
          <p>Allow new people to create accounts on this server.</p>
          <button
            className="secondary-button"
            aria-pressed={query.data?.registrationOpen}
            disabled={!query.data || mutation.isPending}
            onClick={() => mutation.mutate(!query.data?.registrationOpen)}
          >
            {query.data?.registrationOpen ? 'Close registration' : 'Open registration'}
          </button>
          <span>{query.data?.registrationOpen ? 'Currently open' : 'Currently closed'}</span>
          {mutation.error && <p role="alert">{errorText(mutation.error)}</p>}
        </div>
      )}
      <p className="notice">
        Manage authenticators in Security & access and agent tokens in AI connections. For help with
        your data, see the <a href="/docs/account-data">account guide</a>.
      </p>
    </>
  );
}

const sections: Record<Section, { label: string; icon: typeof Folder }> = {
  overview: { label: 'Home', icon: House },
  vaults: { label: 'Vaults', icon: Folder },
  agents: { label: 'AI connections', icon: PlugZap },
  settings: { label: 'Account', icon: Settings },
  security: { label: 'Security & access', icon: ShieldCheck },
  sessions: { label: 'Sessions', icon: Monitor },
};
// Rarely visited account pages share one sidebar entry and switch with tabs in the page.
const settingsTabs: Section[] = ['settings', 'security', 'sessions'];
const pageTitle = (section: Section) =>
  settingsTabs.includes(section) ? 'Settings' : sections[section].label;

/** A real link (new tab, copy address) that navigates in place on a plain click. */
function AppLink({
  href,
  go,
  current,
  className = '',
  title,
  children,
}: {
  href: string;
  go: () => void;
  current?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      title={title}
      className={`${className} ${current ? 'selected' : ''}`}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button)
          return;
        event.preventDefault();
        go();
      }}
    >
      {children}
    </a>
  );
}

const collapsedKey = 'helious.sidebarCollapsed';
function useCollapsedSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(collapsedKey) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((value) => {
      try {
        localStorage.setItem(collapsedKey, value ? '0' : '1');
      } catch {
        // Storage can be unavailable (private windows); the choice then lasts this visit.
      }
      return !value;
    });
  return [collapsed, toggle] as const;
}

function Dashboard({
  user,
  section: routed,
  routedVault,
}: {
  user: User;
  section?: Section;
  routedVault?: string;
}) {
  const ui = useUi();
  const section = routed ?? ui.section;
  const [collapsed, toggleCollapsed] = useCollapsedSidebar();
  const client = useQueryClient();
  const protection = useQuery({
    queryKey: ['security-status'],
    queryFn: () => api<{ pendingApprovals: number }>('/security/status'),
    refetchInterval: 10000,
  });
  const vaults = useQuery({
    queryKey: ['vaults', user.id],
    queryFn: () => api<{ vaults: { id: string; name: string }[] }>('/vaults'),
  });
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', 'POST'),
    onSuccess: () => {
      client.clear();
      window.location.assign('/login');
    },
  });
  // Stable so the library's change effect does not re-run on every render.
  const onVaultChange = useCallback(
    (id: string | undefined) => {
      useUi.getState().setVault(id);
      if (id && routed) replaceVaultUrl(id);
    },
    [routed],
  );
  const clearCreateRequest = useCallback(() => useUi.setState({ createVaultPending: false }), []);
  const pending = protection.data?.pendingApprovals ?? 0;
  const inSettings = settingsTabs.includes(section);
  // A history/bookmark destination must win before effects update remembered UI state.
  const requestedVault = routed === 'vaults' ? (routedVault ?? ui.vault) : ui.vault;
  const openVault = vaults.data?.vaults.find((item) => item.id === requestedVault);
  const link = (id: Section, className = '') => {
    const { label, icon: Icon } = sections[id];
    const name = id === 'settings' ? 'Settings' : label;
    const current = id === 'settings' ? inSettings : section === id;
    return (
      <AppLink
        key={id}
        href={`/app/${sectionPaths[id]}`}
        go={() => ui.setSection(id)}
        current={current}
        className={`nav-${id} ${className}`}
        title={name}
      >
        <Icon size={18} aria-hidden="true" />
        <span className="nav-label">{name}</span>
        {id === 'settings' && pending > 0 && (
          <span className="nav-badge" aria-label={`, ${pending} waiting for approval`}>
            {pending}
          </span>
        )}
      </AppLink>
    );
  };
  return (
    <div
      className={`dashboard ${section === 'vaults' ? 'workspace-dashboard' : ''} ${
        collapsed ? 'sidebar-collapsed' : ''
      }`}
    >
      <aside className="app-sidebar">
        <Brand />
        <nav aria-label="Workspace" className="sidebar-main">
          <div className="sidebar-nav">
            <div className="nav-group">
              {link('overview')}
              {link('agents')}
            </div>
            <div className="nav-group nav-vaults" role="group" aria-labelledby="nav-vaults-heading">
              <div className="nav-group-head">
                <AppLink
                  href={`/app/${sectionPaths.vaults}`}
                  go={() => ui.setSection('vaults')}
                  className="nav-group-label"
                  title="Vaults"
                >
                  <span id="nav-vaults-heading">Vaults</span>
                </AppLink>
                <button
                  className="nav-add"
                  aria-label="Add a vault"
                  title="Add a vault"
                  onClick={ui.requestCreateVault}
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
              </div>
              {vaults.isPending ? (
                <div className="nav-skeleton" aria-hidden="true">
                  <Skeleton height={28} radius={7} />
                  <Skeleton height={28} radius={7} width="80%" />
                </div>
              ) : vaults.data?.vaults.length ? (
                vaults.data.vaults.map((item) => (
                  <AppLink
                    key={item.id}
                    href={`/app/vaults/${item.id}`}
                    go={() => ui.openVault(item.id)}
                    current={section === 'vaults' && openVault?.id === item.id}
                    className="nav-vault"
                    title={item.name}
                  >
                    <span className="nav-vault-mark" aria-hidden="true">
                      {item.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="nav-label">{item.name}</span>
                  </AppLink>
                ))
              ) : (
                <button className="nav-empty" onClick={ui.requestCreateVault}>
                  <Plus size={15} aria-hidden="true" />
                  <span className="nav-label">Create your first vault</span>
                </button>
              )}
            </div>
          </div>
          <div className="sidebar-bottom">
            {link('settings')}
            <a href="/docs/" title="Help & docs" className="nav-help">
              <BookOpen size={18} aria-hidden="true" />
              <span className="nav-label">Help & docs</span>
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
            <button
              className="sidebar-collapse"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              onClick={toggleCollapsed}
            >
              {collapsed ? (
                <PanelLeftOpen size={18} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={18} aria-hidden="true" />
              )}
              <span className="nav-label">Collapse</span>
            </button>
          </div>
        </nav>
      </aside>
      <nav aria-label="Workspace" className="mobile-tabbar">
        {link('overview')}
        {link('vaults')}
        {link('agents')}
        {link('settings')}
      </nav>
      <main className="dashboard-main">
        <header className="dashboard-top">
          <span className="workspace-breadcrumb">
            {pageTitle(section)}
            {(inSettings || (section === 'vaults' && openVault)) && (
              <>
                <ChevronRight size={13} aria-hidden="true" />
                <span>{inSettings ? sections[section].label : openVault?.name}</span>
              </>
            )}
          </span>
          <ThemeToggle />
          <ProfileMenu
            user={user}
            navigate={ui.setSection}
            signOut={() => logout.mutate()}
            pending={logout.isPending}
          />
        </header>
        <div className="dashboard-content">
          {logout.error && (
            <p role="alert" className="error-message">
              {errorText(logout.error)}
            </p>
          )}
          {inSettings && (
            <nav className="settings-tabs" aria-label="Settings">
              {settingsTabs.map((id) => (
                <AppLink
                  key={id}
                  href={`/app/${sectionPaths[id]}`}
                  go={() => ui.setSection(id)}
                  current={section === id}
                >
                  {sections[id].label}
                  {id === 'security' && pending > 0 && (
                    <span className="nav-badge" aria-label={`, ${pending} waiting for approval`}>
                      {pending}
                    </span>
                  )}
                </AppLink>
              ))}
            </nav>
          )}
          {section === 'vaults' ? (
            <Suspense fallback={<PageSkeleton label="Opening your vaults…" />}>
              <VaultLibrary
                userId={user.id}
                requestedVault={requestedVault}
                createRequested={ui.createVaultPending}
                onCreateHandled={clearCreateRequest}
                onVaultChange={onVaultChange}
              />
            </Suspense>
          ) : section === 'sessions' ? (
            <Sessions />
          ) : section === 'security' ? (
            <Suspense fallback={<PageSkeleton label="Opening security settings…" />}>
              <SecurityPanel />
            </Suspense>
          ) : section === 'agents' ? (
            <Suspense fallback={<PageSkeleton label="Opening your connections…" />}>
              <AgentConnections />
            </Suspense>
          ) : section === 'settings' ? (
            <AdminSettings user={user} />
          ) : (
            <Suspense fallback={<PageSkeleton label="Opening your home page…" />}>
              <Overview user={user} />
            </Suspense>
          )}
        </div>
      </main>
    </div>
  );
}

const useAccount = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User }>('/auth/me'),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 1,
  });
const signedOut = (error: Error | null) =>
  error instanceof ApiError && [401, 403].includes(error.status);
const defaultPath = `/app/${sectionPaths.vaults}`;
// Only same-app workspace paths are accepted as a post-sign-in destination.
const nextPath = () => {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && /^\/app\/[\w/?=&%-]*$/.test(next) && !next.startsWith('//') ? next : defaultPath;
};
const signInFor = (path: string) =>
  path === defaultPath ? '/login' : `/login?next=${encodeURIComponent(path)}`;

function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useLayoutEffect(() => router.history.replace(to), [router, to]);
  return null;
}

function Unreachable({ error, retry }: { error: Error | null; retry: () => void }) {
  return (
    <main className="loading-page">
      <Brand />
      <h1>We can’t reach your server.</h1>
      <p role="alert">{errorText(error)}</p>
      <button className="secondary-button" onClick={retry}>
        Try again
      </button>
      <a href="/docs/getting-started">Read the setup guide</a>
    </main>
  );
}

function NotFound() {
  useEffect(() => {
    document.title = 'Page not found · Helious';
  }, []);
  return (
    <main className="loading-page">
      <Brand />
      <h1>This page isn’t here.</h1>
      <a href={defaultPath}>Return to your workspace</a>
    </main>
  );
}

function AuthRoute({ mode }: { mode: 'login' | 'register' }) {
  const user = useAccount();
  useEffect(() => {
    document.title = `${mode === 'login' ? 'Sign in' : 'Create your account'} · Helious`;
  }, [mode]);
  if (user.isPending)
    return (
      <main className="loading-page auth-skeleton">
        <Brand />
        <RowsSkeleton label="Checking your session…" rows={2} />
      </main>
    );
  if (user.data) return <Redirect to={nextPath()} />;
  if (signedOut(user.error)) return <Auth mode={mode} />;
  return <Unreachable error={user.error} retry={() => void user.refetch()} />;
}

function WorkspaceRoute() {
  const { pathname } = useLocation();
  const path = pathname.replace(/^\/app\//, '').replace(/\/$/, '');
  const vault = /^vaults\/([\w-]+)$/.exec(path)?.[1];
  const section = vault ? 'vaults' : sectionForPath(path);
  const user = useAccount();
  useEffect(() => {
    if (!section) return;
    useUi.setState(vault ? { section, vault } : { section });
    document.title = `${pageTitle(section)} · Helious`;
  }, [section, vault]);
  if (!section) return <NotFound />;
  if (user.isPending) return <ShellSkeleton />;
  if (signedOut(user.error)) return <Redirect to={signInFor(pathname)} />;
  if (user.data) return <Dashboard user={user.data.user} section={section} routedVault={vault} />;
  return <Unreachable error={user.error} retry={() => void user.refetch()} />;
}

function ConsentRoute() {
  const user = useAccount();
  if (user.isPending) return <ShellSkeleton />;
  if (signedOut(user.error))
    return <Redirect to={signInFor(`/app/oauth/consent${window.location.search}`)} />;
  if (user.data)
    return (
      <Suspense fallback={<PageSkeleton label="Opening consent…" rows={2} />}>
        <OAuthConsent />
      </Suspense>
    );
  return <Unreachable error={user.error} retry={() => void user.refetch()} />;
}

// Older links (emails, bookmarks, the homepage) point at /app/ or /app/?mode=login.
function LegacyIndex() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') !== 'login') return <Redirect to={defaultPath} />;
  params.delete('mode');
  return <Redirect to={`/login${params.size ? `?${params}` : ''}`} />;
}

const rootRoute = createRootRoute({ component: () => <Outlet /> });
const route = (path: string, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });
const router = createRouter({
  routeTree: rootRoute.addChildren([
    route('/login', () => <AuthRoute mode="login" />),
    route('/register', () => <AuthRoute mode="register" />),
    route('/app', LegacyIndex),
    route('/app/oauth/consent', ConsentRoute),
    route('/app/$section', WorkspaceRoute),
    route('/app/settings/$tab', WorkspaceRoute),
    route('/app/vaults/$vault', WorkspaceRoute),
  ]),
  defaultNotFoundComponent: NotFound,
});
bindSectionNavigation((section, vault, replace) => {
  const to = vault ? `/app/vaults/${vault}` : `/app/${sectionPaths[section]}`;
  if (replace) router.history.replace(to);
  else router.history.push(to);
});

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, refetchOnWindowFocus: true } },
});
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      {['/verify-email', '/reset-password', '/forgot-password'].includes(
        window.location.pathname,
      ) ? (
        <EmailFlow />
      ) : (
        <RouterProvider router={router} />
      )}
    </QueryClientProvider>
  </React.StrictMode>,
);
