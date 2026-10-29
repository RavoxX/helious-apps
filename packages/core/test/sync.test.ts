import { it, expect } from 'vitest';
import { planSync, conflictPath, type SyncFile } from '../src/sync.js';
const file = (hash = 'a', path = 'Note.md'): SyncFile => ({
  path,
  hash: hash.repeat(64),
  spaceId: 'code',
  kind: 'note',
});
it('distinguishes first import, unchanged files, one-sided edits and two-sided conflicts', () => {
  const a = file(),
    b = file('b'),
    c = file('c');
  expect(planSync([a], [], {})[0]!.action).toBe('push');
  expect(planSync([], [a], {})[0]!.action).toBe('pull');
  expect(planSync([a], [b], {})[0]!.action).toBe('conflict');
  expect(planSync([a], [a], {})[0]!.action).toBe('equal');
  const base = { 'note.md': { local: a, remote: a } };
  expect(planSync([b], [a], base)[0]!.action).toBe('push');
  expect(planSync([a], [b], base)[0]!.action).toBe('pull');
  expect(planSync([b], [c], base)[0]!.action).toBe('conflict');
});
it('propagates deletions only from a checkpoint and preserves edit-versus-delete conflicts', () => {
  const a = file(),
    base = { 'note.md': { local: a, remote: a } };
  expect(planSync([], [a], base)[0]!.action).toBe('push');
  expect(planSync([a], [], base)[0]!.action).toBe('pull');
  expect(planSync([file('b')], [], base)[0]!.action).toBe('conflict');
  expect(planSync([], [], base)[0]!.action).toBe('equal');
  expect(planSync([], [], { 'note.md': { local: null, remote: null } })[0]).toEqual({
    path: 'note.md',
    local: null,
    remote: null,
    action: 'equal',
  });
  expect(
    planSync([file('b')], [file('c')], { 'note.md': { ...base['note.md']!, conflict: true } })[0]!
      .action,
  ).toBe('unresolved');
});
it('treats Space and case changes as changes and rejects colliding or unsafe paths', () => {
  const a = file();
  expect(
    planSync([{ ...a, spaceId: 'personal' }], [a], { 'note.md': { local: a, remote: a } })[0]!
      .action,
  ).toBe('push');
  expect(
    planSync([{ ...a, path: 'NOTE.md' }], [a], { 'note.md': { local: a, remote: a } })[0]!.action,
  ).toBe('push');
  expect(() => planSync([a, file('b', 'NOTE.md')], [], {})).toThrow(/case/);
  expect(() => planSync([file('a', '../escape.md')], [], {})).toThrow();
  expect(conflictPath('Projects/Note.md', 'server', '20261029T120000Z', '0123abcd')).toBe(
    'Projects/Note.conflict-20261029T120000Z-server-0123abcd.md',
  );
});
