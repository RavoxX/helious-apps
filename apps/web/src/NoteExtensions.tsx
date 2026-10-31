import { useEffect, useState } from 'react';
import {
  exampleExtension,
  runExtension,
  validateExtension,
  type ExtensionManifest,
  type ExtensionPermission,
} from '@helious/core';
import './extensions.css';
interface Installed {
  manifest: ExtensionManifest;
  granted: ExtensionPermission[];
  enabled: boolean;
}
function load(userId: string): Installed[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`helious-extensions:${userId}`) ?? '[]');
    if (!Array.isArray(raw) || raw.length > 10) return [];
    return raw.flatMap((item: unknown) => {
      try {
        if (
          !item ||
          typeof item !== 'object' ||
          !('manifest' in item) ||
          !('granted' in item) ||
          !('enabled' in item)
        )
          return [];
        const manifest = validateExtension(item.manifest);
        const granted = item.granted;
        if (!Array.isArray(granted) || manifest.permissions.some((p) => !granted.includes(p)))
          return [];
        return [{ manifest, granted: manifest.permissions, enabled: item.enabled === true }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
export function NoteExtensions({
  userId,
  source,
  path,
  noteId,
  apply,
}: {
  userId: string;
  source: string;
  path: string;
  noteId: string;
  apply: (source: string) => void;
}) {
  const [library, setLibrary] = useState(() => load(userId));
  const [input, setInput] = useState('');
  const [candidate, setCandidate] = useState<ExtensionManifest | null>(null);
  const [consent, setConsent] = useState(false);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<{ base: string; noteId: string; source: string } | null>(
    null,
  );
  useEffect(() => {
    const refresh = () => setLibrary(load(userId));
    window.addEventListener('storage', refresh);
    window.addEventListener('helious-extensions', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('helious-extensions', refresh);
    };
  }, [userId]);
  function save(records: Installed[]) {
    try {
      localStorage.setItem(`helious-extensions:${userId}`, JSON.stringify(records));
      setLibrary(records);
      setProposal(null);
      window.dispatchEvent(new Event('helious-extensions'));
      setError('');
    } catch {
      setError('Could not save extensions in this browser. Your draft is unchanged.');
    }
  }
  const commands = library
    .filter((e) => e.enabled)
    .flatMap((e) =>
      e.manifest.commands.map((command) => ({
        record: e,
        command,
        key: `${e.manifest.id}/${command.id}`,
      })),
    );
  return (
    <details className="note-extensions">
      <summary>Extensions</summary>
      <p>
        API 1 extensions are bounded data-only commands. They can access this editor draft after
        your permission; they cannot run scripts, read other notes, use the network, access files or
        resolve secrets.
      </p>
      <div className="extension-command">
        <label>
          Extension command
          <select
            aria-label="Extension command"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              setProposal(null);
            }}
          >
            <option value="">Choose a command</option>
            {commands.map((item) => (
              <option key={item.key} value={item.key}>
                {item.record.manifest.name} · {item.command.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!selected}
          onClick={() => {
            try {
              const item = commands.find((c) => c.key === selected);
              if (!item) throw Error('Enable the extension before running it.');
              const result = runExtension(
                item.record.manifest,
                item.command.id,
                item.record.granted,
                { source, path },
              );
              setProposal({ base: source, noteId, source: result.source });
              setMessage(result.message);
              setError('');
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Unable to run extension.');
              setProposal(null);
            }
          }}
        >
          Preview command
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {proposal && proposal.source !== proposal.base && (
        <div className="extension-proposal">
          <label>
            Proposed Markdown
            <textarea readOnly rows={8} value={proposal.source} />
          </label>
          <p>Review this proposal. Applying changes the draft; Save note persists it.</p>
          <button
            type="button"
            disabled={source !== proposal.base || noteId !== proposal.noteId}
            onClick={() => {
              if (source !== proposal.base || noteId !== proposal.noteId) {
                setError('Your draft changed. Run the command again.');
                return;
              }
              apply(proposal.source);
              setProposal(null);
              setMessage('Proposal applied to draft. Save explicitly to keep it.');
            }}
          >
            Apply proposal to draft
          </button>
          {(source !== proposal.base || noteId !== proposal.noteId) && (
            <p>Your draft changed. Run the command again to create a fresh proposal.</p>
          )}
        </div>
      )}
      <details>
        <summary>Manage extensions</summary>
        {library.map((record) => (
          <div className="extension-installed" key={record.manifest.id}>
            <label>
              <input
                type="checkbox"
                checked={record.enabled}
                onChange={(event) =>
                  save(
                    library.map((e) =>
                      e.manifest.id === record.manifest.id
                        ? { ...e, enabled: event.target.checked }
                        : e,
                    ),
                  )
                }
              />
              {record.manifest.name} · {record.manifest.version}
            </label>
            <button
              type="button"
              onClick={() => {
                save(library.filter((e) => e.manifest.id !== record.manifest.id));
                setProposal(null);
              }}
            >
              Remove {record.manifest.name}
            </button>
          </div>
        ))}
        {!library.length && (
          <p>No extensions installed. Use the example or paste an API 1 manifest.</p>
        )}
        <label>
          Extension manifest (JSON)
          <textarea
            value={input}
            maxLength={65536}
            rows={7}
            onChange={(event) => {
              setInput(event.target.value);
              setCandidate(null);
              setConsent(false);
            }}
          />
        </label>
        <div className="extension-actions">
          <button
            type="button"
            onClick={() => {
              setInput(JSON.stringify(exampleExtension, null, 2));
              setCandidate(null);
              setConsent(false);
            }}
          >
            Use example manifest
          </button>
          <button
            type="button"
            disabled={!input.trim()}
            onClick={() => {
              try {
                setCandidate(validateExtension(JSON.parse(input) as unknown));
                setConsent(false);
                setError('');
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Invalid extension manifest.');
                setCandidate(null);
              }
            }}
          >
            Review extension permissions
          </button>
        </div>
        {candidate && (
          <section className="extension-permissions" aria-label="Extension permissions">
            <strong>
              {candidate.name} · {candidate.version}
            </strong>
            <p>{candidate.description}</p>
            <ul>
              {candidate.permissions.map((permission) => (
                <li key={permission}>
                  {permission === 'editor:read'
                    ? 'Read the current editor draft'
                    : 'Propose changes to the current editor draft'}
                </li>
              ))}
            </ul>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I grant these editor permissions to this extension on this account in this browser.
            </label>
            <button
              type="button"
              disabled={!consent}
              onClick={() => {
                if (!consent) return;
                if (library.length >= 10 && !library.some((e) => e.manifest.id === candidate.id)) {
                  setError('Install at most ten extensions.');
                  return;
                }
                save([
                  ...library.filter((e) => e.manifest.id !== candidate.id),
                  { manifest: candidate, granted: candidate.permissions, enabled: true },
                ]);
                setCandidate(null);
                setConsent(false);
                setInput('');
                setMessage('Extension installed. Choose a command and preview its result.');
              }}
            >
              Install reviewed extension
            </button>
          </section>
        )}
      </details>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
