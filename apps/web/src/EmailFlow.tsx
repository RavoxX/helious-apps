import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Mail, Moon, Sun } from 'lucide-react';
import { api } from './api';
import { useTheme } from './theme';
import './email-flow.css';

export function ResendVerification({ email }: { email: string }) {
  const resend = useMutation({
    mutationFn: () => api<{ message: string }>('/auth/resend-verification', 'POST', { email }),
  });
  return (
    <div className="verification-actions">
      <button
        type="button"
        className="secondary-button"
        disabled={resend.isPending || resend.isSuccess || !email}
        onClick={() => resend.mutate()}
      >
        {resend.isPending ? 'Sending…' : 'Resend verification email'}
      </button>
      {resend.isSuccess && (
        <p role="status">Check your inbox for a fresh link. It expires in 30 minutes.</p>
      )}
      {resend.error && (
        <p role="alert" className="error-message">
          {resend.error.message}
        </p>
      )}
    </div>
  );
}
export function EmailFlow() {
  const path = window.location.pathname;
  const verifying = path === '/verify-email';
  const resetting = path === '/reset-password';
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const { theme, toggle } = useTheme();
  const started = useRef(false);
  const strong =
    password.length >= 12 &&
    password.length <= 128 &&
    new Set(password.toLowerCase()).size >= 5 &&
    !/^(?:password|123456|qwerty)/i.test(password);
  const verify = useMutation({
    mutationFn: () => api('/auth/verify-email', 'POST', { token }),
    onSuccess: () => window.location.replace('/app/?mode=login&verified=1'),
  });
  const request = useMutation({
    mutationFn: () =>
      api<{ message: string }>(
        verifying ? '/auth/resend-verification' : '/auth/forgot-password',
        'POST',
        { email },
      ),
  });
  const reset = useMutation({
    mutationFn: () =>
      api<{ message: string; warning?: string }>('/auth/reset-password', 'POST', {
        token,
        password,
      }),
    onSuccess: () => setPassword(''),
  });
  const status = useMutation({ mutationFn: () => api('/auth/token-status', 'POST', { token }) });
  useEffect(() => {
    document.title = `${verifying ? 'Verify email' : resetting ? 'Reset password' : 'Forgot password'} · Helious`;
    if (token) window.history.replaceState(null, '', path);
    if (verifying && token && !started.current) {
      started.current = true;
      verify.mutate();
    }
    if (resetting && token && !started.current) {
      started.current = true;
      status.mutate();
    }
  }, []);
  const invalid =
    (verifying && (!token || verify.error)) ||
    (resetting && (!token || status.error || reset.error?.message.includes('link')));
  const recovery = !resetting || invalid;
  return (
    <div className="auth-page email-page">
      <header className="auth-header">
        <a href="/" className="brand">
          <img src="/app/helious-logo.png" width="35" height="35" alt="" />
          helious<span>.</span>
        </a>
        <button
          className="app-theme-toggle"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>
      <main className="email-scene">
        <div className="email-card">
          <Mail size={25} strokeWidth={1.5} />
          <p className="milestone">Your Helious account</p>
          <h1>
            {invalid
              ? 'This link has reached its end.'
              : verifying
                ? 'Verifying your email…'
                : resetting
                  ? reset.isSuccess
                    ? 'A fresh start.'
                    : 'Choose a new password.'
                  : 'Let’s get you back in.'}
          </h1>
          {invalid && (
            <p role="alert">
              This link is expired, already used, or invalid. Request a new link below.
            </p>
          )}
          {verifying && !invalid && (
            <p role="status">Confirming your address. You’ll be taken to sign in.</p>
          )}
          {!verifying && !resetting && (
            <p>Enter your email and we’ll send a link to reset your password.</p>
          )}
          {recovery && (!verifying || invalid) && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                request.mutate();
              }}
            >
              <label>
                Email address
                <input
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={request.isPending}>
                {request.isPending
                  ? 'Requesting…'
                  : verifying
                    ? 'Request a new verification link'
                    : 'Send reset link'}
                <ArrowRight size={15} />
              </button>
            </form>
          )}
          {request.isSuccess && (
            <div role="status" className="email-status">
              <Check size={16} />
              <div>
                <p>{request.data.message}</p>
                <p>
                  If it doesn’t arrive, check spam and try again later. Email delivery may be
                  delayed or unavailable.
                </p>
              </div>
            </div>
          )}
          {request.error && (
            <p role="alert" className="error-message">
              We could not request your email. Please try again later.
            </p>
          )}
          {resetting && !invalid && !reset.isSuccess && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (strong && password === confirmation) reset.mutate();
              }}
            >
              <label>
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p className="password-strength" role="status">
                {!password
                  ? 'Use 12–128 characters. Several distinct words work well.'
                  : strong
                    ? 'Ready: a long, varied password.'
                    : 'Use at least 12 characters with more variety; avoid common password patterns.'}
              </p>
              <label>
                Confirm new password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              {confirmation && password !== confirmation && (
                <p className="error-message">The passwords do not match.</p>
              )}
              <button
                className="primary-button"
                disabled={!strong || password !== confirmation || reset.isPending}
              >
                {reset.isPending ? 'Updating…' : 'Set new password'}
                <ArrowRight size={15} />
              </button>
            </form>
          )}
          {reset.isSuccess && (
            <div role="status">
              <p>{reset.data.message}</p>
              {reset.data.warning && <p role="alert">{reset.data.warning}</p>}
              <a href="/app/?mode=login&reset=1" className="primary-button">
                Back to sign in <ArrowRight size={15} />
              </a>
            </div>
          )}
          {reset.error && !invalid && (
            <p role="alert" className="error-message">
              {reset.error.message}
            </p>
          )}
          <a className="back-link" href="/app/?mode=login">
            <ArrowLeft size={13} />
            Back to sign in
          </a>
        </div>
      </main>
    </div>
  );
}
export function ChangeEmail({
  currentEmail,
  pendingEmail,
}: {
  currentEmail: string;
  pendingEmail?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const change = useMutation({
    mutationFn: () => api<{ message: string }>('/account/email', 'POST', { email, password }),
    onSuccess: () => setPassword(''),
  });
  return (
    <section className="change-email">
      <h2>Change email address</h2>
      <p>
        Your current address, {currentEmail}, stays active until you verify the new one. Verifying
        signs out all browser sessions.
      </p>
      {pendingEmail && <p>Pending verification: {pendingEmail}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          change.mutate();
        }}
      >
        <label>
          New email address
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            maxLength={128}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="secondary-button" disabled={change.isPending}>
          {change.isPending ? 'Sending…' : 'Verify new address'}
        </button>
      </form>
      {change.isSuccess && <p role="status">{change.data.message}</p>}
      {change.error && (
        <p className="error-message" role="alert">
          {change.error.message}
        </p>
      )}
    </section>
  );
}
