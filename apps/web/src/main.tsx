import React, { lazy, Suspense, useState } from 'react';
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
} from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleCheck,
  Eye,
  EyeOff,
  Folder,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  Network,
  Settings,
  ShieldCheck,
  PlugZap,
  Sun,
  Trash2,
} from 'lucide-react';
import '@fontsource-variable/manrope';
import { api, ApiError, type Session, type User } from './api';
import { useUi } from './store';
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
const OAuthConsent = lazy(() =>
  import('./AgentConnections').then((module) => ({ default: module.OAuthConsent })),
);
import { EmailFlow, ResendVerification, ChangeEmail } from './EmailFlow';
import './style.css';
import './auth.css';
import './dashboard.css';

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

function Auth() {
  const [mode, setMode] = useState<'register' | 'login'>(() =>
    new URLSearchParams(window.location.search).get('mode') === 'login' ||
    window.location.pathname.includes('/oauth/')
      ? 'login'
      : 'register',
  );
  const [pendingEmail, setPendingEmail] = useState('');
  const [address, setAddress] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const client = useQueryClient();
  const registration = useQuery({
    queryKey: ['registration'],
    queryFn: () => api<{ registrationOpen: boolean }>('/auth/config'),
  });
  const isRegister = mode === 'register' && registration.data?.registrationOpen !== false;
  const mutation = useMutation({
    mutationFn: (data: { email: string; password: string; name?: string; code?: string }) =>
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
            {pendingEmail && (
              <div className="verification-notice">
                <p role="status">
                  Please verify your email. We sent a 30-minute link to {pendingEmail}.
                </p>
                <ResendVerification email={pendingEmail} />
                <a href="/app/?mode=login">Back to sign in</a>
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
                    setMode(isRegister ? 'login' : 'register');
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
        See where you’re signed in. Revoke a session to end access immediately.
      </p>
      {query.isPending && <p role="status">Loading sessions…</p>}
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
            <Monitor size={24} />
            <div>
              <strong>{session.current ? 'This browser' : 'Browser session'}</strong>
              <p className="user-agent">{session.userAgent}</p>
              <small>
                Created {new Date(session.createdAt).toLocaleString()} · Expires{' '}
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
                aria-label="Revoke session"
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
        In-account password changes, 2FA, agent tokens and secret storage arrive in later phases.
        See the <a href="/docs/roadmap">roadmap</a>.
      </p>
    </>
  );
}

function Dashboard({ user }: { user: User }) {
  const { section, setSection } = useUi();
  const client = useQueryClient();
  const protection = useQuery({
    queryKey: ['security-status'],
    queryFn: () => api<{ pendingApprovals: number }>('/security/status'),
    refetchInterval: 10000,
  });
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', 'POST'),
    onSuccess: () => {
      client.clear();
      window.location.assign('/app/');
    },
  });
  return (
    <div className={`dashboard ${section === 'vaults' ? 'workspace-dashboard' : ''}`}>
      <aside className="app-sidebar">
        <Brand />
        <div className="instance-label">
          <span /> Your Helious workspace
        </div>
        <nav aria-label="Workspace">
          <button
            title="Vaults"
            className={section === 'vaults' ? 'selected' : ''}
            onClick={() => setSection('vaults')}
          >
            <Folder size={17} /> Vaults
          </button>
          <button
            title="Overview"
            className={`overview-nav ${section === 'overview' ? 'selected' : ''}`}
            onClick={() => setSection('overview')}
          >
            <LayoutDashboard size={17} /> Overview
          </button>
          <button
            title="Sessions"
            className={section === 'sessions' ? 'selected' : ''}
            onClick={() => setSection('sessions')}
          >
            <Monitor size={17} /> Sessions
          </button>
          <button
            title="Security"
            className={section === 'security' ? 'selected' : ''}
            onClick={() => setSection('security')}
          >
            <ShieldCheck size={17} />
            Security
            {protection.data?.pendingApprovals ? ` (${protection.data.pendingApprovals})` : ''}
          </button>
          <button
            title="Account & server"
            className={section === 'settings' ? 'selected' : ''}
            onClick={() => setSection('settings')}
          >
            <Settings size={17} /> Account & server
          </button>
          <button
            title="AI connections"
            className={`agents-nav ${section === 'agents' ? 'selected' : ''}`}
            onClick={() => setSection('agents')}
          >
            <PlugZap size={17} />
            AI connections
          </button>
        </nav>
        <div className="sidebar-bottom">
          <a href="/docs/" title="Documentation">
            <BookOpen size={16} /> Documentation <ArrowUpRight size={12} />
          </a>
          <button title="Sign out" disabled={logout.isPending} onClick={() => logout.mutate()}>
            <LogOut size={16} /> {logout.isPending ? 'Signing out…' : 'Sign out'}
          </button>
          {logout.error && (
            <p role="alert" className="error-message">
              {errorText(logout.error)}
            </p>
          )}
          <span>{user.email}</span>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="dashboard-top">
          <ThemeToggle />
          <span className="workspace-breadcrumb">
            My workspace <ChevronRight size={12} />{' '}
            {section === 'overview'
              ? 'Overview'
              : section === 'vaults'
                ? 'Vaults'
                : section === 'sessions'
                  ? 'Sessions'
                  : section === 'security'
                    ? 'Security & access'
                    : section === 'agents'
                      ? 'AI connections'
                      : 'Account & server'}
          </span>
          <ProfileMenu
            user={user}
            navigate={setSection}
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
          {section === 'vaults' ? (
            <Suspense fallback={<p role="status">Opening your notebook…</p>}>
              <VaultLibrary userId={user.id} />
            </Suspense>
          ) : section === 'sessions' ? (
            <Sessions />
          ) : section === 'security' ? (
            <Suspense fallback={<p role="status">Opening security settings…</p>}>
              <SecurityPanel />
            </Suspense>
          ) : section === 'agents' ? (
            <Suspense fallback={<p role="status">Opening your connections…</p>}>
              <AgentConnections />
            </Suspense>
          ) : section === 'settings' ? (
            <AdminSettings user={user} />
          ) : (
            <>
              <div className="milestone">
                <span /> Your foundation is ready
              </div>
              <h1>
                A little space to think,
                <br />
                {user.name.split(' ')[0]}.
              </h1>
              <p className="page-description">
                You’re signed in. This is the start of your Helious workspace.
              </p>
              <div className="welcome-panel">
                <CircleCheck size={28} />
                <div>
                  <h2>Your account is all set.</h2>
                  <p>
                    Secure sessions are running on your server.{' '}
                    {user.role === 'admin'
                      ? 'As the first account, you are this instance’s administrator.'
                      : 'Your data stays on this instance.'}
                  </p>
                </div>
              </div>
              <section className="next-phase">
                <div>
                  <Network size={31} strokeWidth={1} />
                  <h2>Your notes have a home.</h2>
                  <p>
                    Create a vault, write Markdown, connect your notes and search your knowledge.
                    Write in source, live preview or reading mode, with tabs to keep your place.
                  </p>
                  <button className="secondary-button" onClick={() => setSection('vaults')}>
                    Open your vaults <ArrowRight size={14} />
                  </button>
                </div>
                <div className="roadmap-mini">
                  <p>
                    <Check size={15} />
                    <span>Account & sessions</span>
                    <small>Ready</small>
                  </p>
                  <p>
                    <Check size={15} />
                    <span>Vaults & knowledge engine</span>
                    <small>Ready</small>
                  </p>
                  <p>
                    <span className="step-dot" />
                    <span>Markdown workspace</span>
                    <small>Ready</small>
                  </p>
                  <p>
                    <span className="step-dot" />
                    <span>Graph & analytics</span>
                    <small>Ready in Vaults</small>
                  </p>
                </div>
              </section>
              <div className="dashboard-links">
                <a href="/docs/security">
                  <ShieldCheck size={18} />
                  <span>Understand your security</span>
                  <ArrowUpRight size={15} />
                </a>
                <button onClick={() => setSection('sessions')}>
                  <Monitor size={18} />
                  <span>Manage active sessions</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Workspace() {
  const user = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User }>('/auth/me'),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 1,
  });
  if (user.isPending)
    return (
      <main className="loading-page">
        <Brand />
        <LoaderCircle className="spinner" />
        <p>Opening your workspace…</p>
      </main>
    );
  if (user.error instanceof ApiError && [401, 403].includes(user.error.status)) return <Auth />;
  if (user.data)
    return window.location.pathname === '/app/oauth/consent' ? (
      <Suspense fallback={<p role="status">Opening consent…</p>}>
        <OAuthConsent />
      </Suspense>
    ) : (
      <Dashboard user={user.data.user} />
    );
  return (
    <main className="loading-page">
      <Brand />
      <h1>We can’t reach your server.</h1>
      <p role="alert">{errorText(user.error)}</p>
      <button
        className="secondary-button"
        onClick={() => {
          void user.refetch();
        }}
      >
        Try again
      </button>
      <a href="/docs/getting-started">Read the setup guide</a>
    </main>
  );
}

const rootRoute = createRootRoute({ component: () => <Outlet /> });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Workspace,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    createRoute({ getParentRoute: () => rootRoute, path: '/oauth/consent', component: Workspace }),
  ]),
  basepath: '/app',
  defaultNotFoundComponent: () => (
    <main className="loading-page">
      <Brand />
      <h1>This page isn’t here.</h1>
      <a href="/app/">Return to your workspace</a>
    </main>
  ),
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
