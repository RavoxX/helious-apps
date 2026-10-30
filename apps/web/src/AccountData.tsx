import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type User } from './api';
import { discardAllDrafts } from './drafts';
import './account-data.css';

export function AccountData({ user }: { user: User }) {
  const client = useQueryClient();
  const [name, setName] = useState(user.name),
    [password, setPassword] = useState(''),
    [code, setCode] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [download, setDownload] = useState('');
  const [deleting, setDeleting] = useState(false),
    [confirmation, setConfirmation] = useState('');
  async function act(event: FormEvent, work: () => Promise<void>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to complete this action. Try again.',
      );
    } finally {
      setBusy(false);
      setPassword('');
      setCode('');
    }
  }
  const credentials = () => ({ password, ...(user.totpEnabled ? { code } : {}) });
  const proofFields = (prefix: string) => (
    <>
      <label htmlFor={`${prefix}-password`}>
        Current password for {prefix === 'export' ? 'export' : 'deletion'}
      </label>
      <input
        id={`${prefix}-password`}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        maxLength={128}
      />
      {user.totpEnabled && (
        <>
          <label htmlFor={`${prefix}-code`}>
            Authenticator or recovery code for {prefix === 'export' ? 'export' : 'deletion'}
          </label>
          <input
            id={`${prefix}-code`}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            maxLength={128}
          />
        </>
      )}
    </>
  );
  return (
    <div className="account-data">
      <section aria-labelledby="profile-correction">
        <h2 id="profile-correction">Your profile</h2>
        <form
          onSubmit={(e) =>
            void act(e, async () => {
              await api('/account/profile', 'PATCH', { name });
              await client.invalidateQueries({ queryKey: ['me'] });
              setNotice('Your name has been updated.');
            })
          }
        >
          <label htmlFor="profile-name">Display name</label>
          <input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            maxLength={80}
          />
          <button className="secondary-button" disabled={busy || name.trim() === user.name}>
            Save name
          </button>
        </form>
      </section>
      <section aria-labelledby="data-export">
        <h2 id="data-export">Take a copy of your data</h2>
        <p>
          Download your account information, Markdown notes, attachments, history and activity in a
          portable ZIP. Secret values, passwords and authentication credentials are excluded.
        </p>
        <p>
          Keep the download private. It contains Personal notes and is not a consistent database
          backup.
        </p>
        <form
          onSubmit={(e) =>
            void act(e, async () => {
              setDownload('');
              const result = await api<{ url: string }>('/account/export', 'POST', credentials());
              setDownload(result.url);
            })
          }
        >
          {proofFields('export')}
          <button className="secondary-button" disabled={busy}>
            Prepare export
          </button>
        </form>
        {download && (
          <p role="status">
            Your link expires in five minutes and works once in this browser session.
          </p>
        )}
        {download && (
          <a
            className="primary-button"
            href={download}
            download
            referrerPolicy="no-referrer"
            onClick={() => {
              setTimeout(() => setDownload(''), 1000);
            }}
          >
            Download ZIP
          </a>
        )}
      </section>
      <section className="account-erasure" aria-labelledby="account-erasure">
        <h2 id="account-erasure">Delete your account</h2>
        <p>
          This ends all sessions and agent access immediately, then permanently removes your server
          vaults, attachments, history, secrets and account data. Export anything you need first.
        </p>
        <p>
          Erasure normally finishes within 24 hours. Downloads, local device copies and separately
          retained backups or provider records are handled separately. The last administrator must
          transfer access first.
        </p>
        {!deleting ? (
          <button
            className="danger-button"
            onClick={() => {
              setDeleting(true);
              setDownload('');
            }}
          >
            Delete account…
          </button>
        ) : (
          <form
            onSubmit={(e) =>
              void act(e, async () => {
                await api('/account/delete', 'POST', { ...credentials(), confirmation });
                discardAllDrafts();
                client.clear();
                window.location.replace('/app/?mode=login&deleted=1');
              })
            }
          >
            {proofFields('delete')}
            <label htmlFor="delete-confirmation">Type DELETE {user.email} to confirm</label>
            <input
              id="delete-confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <div className="account-data-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeleting(false);
                  setPassword('');
                  setCode('');
                  setConfirmation('');
                }}
              >
                Keep account
              </button>
              <button
                className="danger-button"
                disabled={busy || confirmation !== `DELETE ${user.email}`}
              >
                Permanently delete account
              </button>
            </div>
          </form>
        )}
      </section>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
