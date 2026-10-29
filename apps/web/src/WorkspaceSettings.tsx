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
  const [shortcuts, setShortcuts] = useState(value.shortcuts);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  return (
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
  );
}
