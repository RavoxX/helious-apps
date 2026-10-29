/** Portable vault paths are logical paths, never operating-system filesystem paths. */
export function normalizeVaultPath(value: string): string {
  const path = value.normalize('NFC');
  if (
    !path ||
    path.length > 1024 ||
    path.startsWith('/') ||
    // Reject control bytes as well as characters that cannot round-trip to desktop vaults.
    // eslint-disable-next-line no-control-regex
    /[\\\u0000-\u001f\u007f<>:"|?*]/u.test(path)
  )
    throw new Error('Use a relative vault path without reserved characters');
  const segments = path.split('/');
  if (
    segments.length > 32 ||
    segments.some(
      (part) => !part || part === '.' || part === '..' || part.length > 255 || /[. ]$/.test(part),
    )
  )
    throw new Error('Invalid vault path segment');
  if (segments.some((part) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new Error('This path uses a reserved device name');
  if (segments[0]?.toLowerCase() === '.helious') throw new Error('The .helious folder is reserved');
  return segments.join('/');
}

export function normalizeNotePath(value: string): string {
  const path = normalizeVaultPath(value);
  if (!/\.md$/i.test(path)) throw new Error('Notes must have a .md extension');
  return path;
}

export const pathKey = (value: string) => value.normalize('NFC').toLowerCase();
export const basename = (value: string) => value.split('/').at(-1)!;
export const dirname = (value: string) =>
  value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : '';

export function resolveRelativePath(from: string, target: string): string | null {
  if (target.startsWith('/')) return null;
  const result = dirname(from).split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (part === '..') {
      if (!result.length) return null;
      result.pop();
    } else if (part && part !== '.') result.push(part);
  }
  try {
    return normalizeVaultPath(result.join('/'));
  } catch {
    return null;
  }
}
