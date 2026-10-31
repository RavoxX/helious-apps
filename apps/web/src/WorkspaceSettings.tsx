import { compileReadingCss } from './appearance';
import { useState } from 'react';
import {
  defaultShortcuts,
  shortcutLabels,
  validateShortcuts,
  type Preferences,
  type ShortcutAction,
} from './preferences';

export function WorkspaceSettings({
  value,
  save,
}: {
  value: Preferences;
  save: (value: Preferences) => void;
}) {
  const [snippet, setSnippet] = useState(value.cssSnippet ?? '');
  const [appearanceError, setAppearanceError] = useState('');
  const [appearanceSaved, setAppearanceSaved] = useState(false);
  const [shortcuts, setShortcuts] = useState(value.shortcuts);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <>
      <details className="workspace-settings">
        <summary>Hotkeys</summary>
        <form
          data-hotkey-editor
          onSubmit={(event) => {
            event.preventDefault();
            const invalid = validateShortcuts(shortcuts);
            if (invalid) {
              setError(invalid);
              return;
            }
            save({ ...value, shortcuts });
            setError('');
            setSaved(true);
          }}
        >
          <p>Mod means Ctrl on Windows and Cmd on macOS. Saved for this account in this browser.</p>
          {(Object.keys(shortcutLabels) as ShortcutAction[]).map((action) => (
            <label key={action}>
              {shortcutLabels[action]}
              <input
                aria-label={`${shortcutLabels[action]} shortcut`}
                value={shortcuts[action]}
                maxLength={24}
                onChange={(event) => {
                  setShortcuts({ ...shortcuts, [action]: event.target.value });
                  setSaved(false);
                }}
              />
            </label>
          ))}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {saved && <p role="status">Hotkeys saved.</p>}
          <div>
            <button className="secondary-button" type="submit">
              Save hotkeys
            </button>
            <button
              type="button"
              className="subtle-button"
              onClick={() => {
                setShortcuts({ ...defaultShortcuts });
                setError('');
                setSaved(false);
              }}
            >
              Restore defaults
            </button>
          </div>
        </form>
      </details>
      <details className="workspace-settings reading-snippets">
        <summary>Reading appearance</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              compileReadingCss(snippet, 'validation');
              save({ ...value, cssSnippet: snippet });
              setAppearanceError('');
              setAppearanceSaved(true);
            } catch (error) {
              setAppearanceError(
                error instanceof Error ? error.message : 'Invalid reading snippet.',
              );
            }
          }}
        >
          <p>
            Style note reading content in this browser. Use .markdown-reading followed by ordinary
            content elements, for example .markdown-reading h1 &#123; color: #2878ba; &#125;. Only
            bounded typography, colors and spacing are supported. Scripts, resources and controls
            cannot be styled.
          </p>
          <label>
            Reading CSS snippet
            <textarea
              rows={6}
              maxLength={16384}
              value={snippet}
              onChange={(event) => {
                setSnippet(event.target.value);
                setAppearanceSaved(false);
              }}
            />
          </label>
          {appearanceError && <p role="alert">{appearanceError}</p>}
          {appearanceSaved && <p role="status">Reading appearance saved.</p>}
          <button type="submit" className="secondary-button">
            Save reading appearance
          </button>
          <button
            type="button"
            className="subtle-button"
            onClick={() => {
              setSnippet('');
              save({ ...value, cssSnippet: '' });
              setAppearanceError('');
              setAppearanceSaved(true);
            }}
          >
            Reset reading appearance
          </button>
        </form>
      </details>
    </>
  );
}
