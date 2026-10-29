import { useSyncExternalStore } from 'react';
const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
function subscribe(change: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== 'helious-theme' || !['dark', 'light'].includes(event.newValue ?? '')) return;
    document.documentElement.dataset.theme = event.newValue!;
    change();
  };
  window.addEventListener('helious:theme', change);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener('helious:theme', change);
    window.removeEventListener('storage', storage);
  };
}
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, currentTheme);
  const toggle = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('helious-theme', next);
    } catch {
      /* Theme still works without persistence. */
    }
    window.dispatchEvent(new Event('helious:theme'));
  };
  return { theme, toggle };
}
