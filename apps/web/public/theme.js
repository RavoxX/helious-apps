(() => {
  let saved;
  try {
    saved = localStorage.getItem('helious-theme');
  } catch {
    /* Storage may be disabled. */
  }
  document.documentElement.dataset.theme =
    saved === 'light' || saved === 'dark'
      ? saved
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
})();
