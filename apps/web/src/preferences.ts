export const defaultShortcuts = {
  save: 'Mod+S',
  commands: 'Mod+P',
  switcher: 'Mod+O',
  create: 'Mod+Shift+K',
  reading: 'Mod+E',
  split: 'Mod+Shift+E',
};
export type ShortcutAction = keyof typeof defaultShortcuts;
export type Shortcuts = Record<ShortcutAction, string>;
export interface Preferences {
  bookmarks: string[];
  shortcuts: Shortcuts;
}
export const shortcutLabels: Record<ShortcutAction, string> = {
  save: 'Save note',
  commands: 'Command palette',
  switcher: 'Quick switcher',
  create: 'New note',
  reading: 'Toggle reading',
  split: 'Toggle split pane',
};
export function validateShortcuts(value: Shortcuts) {
  const keys = Object.values(value).map((key) => key.toLowerCase());
  if (keys.some((key) => !/^mod\+(?:alt\+)?(?:shift\+)?[a-z0-9]$/.test(key)))
    return 'Use Mod+S or Mod+Alt+Shift+S (one letter or digit).';
  if (keys.some((key) => /^mod\+(?:shift\+)?[wtnlqr]$/.test(key)))
    return 'That shortcut is reserved for browser navigation. Choose another combination.';
  if (new Set(keys).size !== keys.length) return 'Each action needs a different shortcut.';
  return null;
}
export function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  const parts = shortcut.toLowerCase().split('+');
  return (
    !event.isComposing &&
    (event.ctrlKey || event.metaKey) &&
    event.altKey === parts.includes('alt') &&
    event.shiftKey === parts.includes('shift') &&
    event.key.toLowerCase() === parts.at(-1)
  );
}
export function loadPreferences(userId: string): Preferences {
  try {
    const raw = JSON.parse(
      localStorage.getItem(`helious-preferences:${userId}`) ?? 'null',
    ) as Partial<Preferences> | null;
    const shortcuts = { ...defaultShortcuts, ...raw?.shortcuts };
    return {
      bookmarks: Array.isArray(raw?.bookmarks)
        ? raw.bookmarks
            .filter((id): id is string => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id))
            .slice(0, 1000)
        : [],
      shortcuts: validateShortcuts(shortcuts) ? { ...defaultShortcuts } : shortcuts,
    };
  } catch {
    return { bookmarks: [], shortcuts: { ...defaultShortcuts } };
  }
}
