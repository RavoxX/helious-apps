import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { exampleExtension, runExtension, validateExtension } from '../src/extensions.js';
it('requires explicit grants, refuses executable/unknown capabilities and bounds literal transformations', () => {
  expect(() =>
    runExtension(exampleExtension, 'words', [], { source: 'Private draft', path: 'Note.md' }),
  ).toThrow(/Grant/);
  for (const extra of [
    { script: 'fetch()' },
    { permissions: ['network'] },
    { commands: [{ id: 'run', name: 'Run', steps: [{ op: 'eval', text: 'x' }] }] },
  ])
    expect(() => validateExtension({ ...exampleExtension, ...extra })).toThrow();
  expect(() =>
    validateExtension({
      ...exampleExtension,
      commands: [{ id: 'run', name: 'Run', steps: [{ op: 'replace', find: '', text: 'x' }] }],
    }),
  ).toThrow();
  const huge = {
    ...exampleExtension,
    commands: [
      { id: 'run', name: 'Run', steps: [{ op: 'replace' as const, find: 'a', text: 'xx' }] },
    ],
  };
  expect(() =>
    runExtension(huge, 'run', huge.permissions, { source: 'a'.repeat(1001), path: 'x.md' }),
  ).toThrow(/match/);
});
it('proposes draft-only changes, preserves secret references and edits properties losslessly', () => {
  const source = '---\n# Keep comment\nstatus: draft\n---\n# Private draft\n{{secret:key}}';
  const manifest = validateExtension({
    ...exampleExtension,
    commands: [
      {
        id: 'run',
        name: 'Run',
        steps: [
          { op: 'setProperty', key: 'approved', value: true },
          { op: 'append', text: '\n{{title}} {{date}} {{secret:new}}' },
        ],
      },
    ],
  });
  const result = runExtension(manifest, 'run', manifest.permissions, {
    source,
    path: 'Projects/Review.md',
    now: new Date('2026-10-31T12:00:00Z'),
  });
  expect(result.source).toContain('# Keep comment');
  expect(result.source).toContain('approved: true');
  expect(result.source).toContain('{{secret:key}}');
  expect(result.source).toContain('Review 2026-10-31 {{secret:new}}');
  expect(source).not.toContain('approved');
});

it('matches the shared browser/native extension contract', () => {
  const cases = JSON.parse(
    readFileSync(new URL('../examples/extension-contract.json', import.meta.url), 'utf8'),
  ) as {
    steps: unknown[];
    source?: string;
    expected?: string;
    message?: string;
    invalid?: boolean;
  }[];
  for (const item of cases) {
    const value = {
      ...exampleExtension,
      commands: [{ id: 'run', name: 'Run', steps: item.steps }],
    };
    if (item.invalid) {
      expect(() => validateExtension(value)).toThrow();
      continue;
    }
    const manifest = validateExtension(value);
    const result = runExtension(manifest, 'run', manifest.permissions, {
      source: item.source ?? '',
      path: 'Projects/Review.md',
      now: new Date('2026-10-31T12:00:00Z'),
    });
    expect(result.source).toBe(item.expected);
    if (item.message) expect(result.message).toBe(item.message);
  }
});
