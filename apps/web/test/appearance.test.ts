import { expect, test } from 'vitest';
import { compileReadingCss, safeReadingSnippet } from '../src/appearance.js';
test('reading snippets are scoped and cannot style controls or load resources', () => {
  expect(
    compileReadingCss('.markdown-reading h1 { color: #123456; font-size: 32px; }', 'note-1'),
  ).toBe('[data-reading-style="note-1"] .markdown-reading h1{color:#123456;font-size:32px}');
  for (const css of [
    'body {color:red}',
    '.markdown-reading,button {color:red}',
    '@import "https://evil.invalid";',
    '.markdown-reading {background:url(https://evil.invalid)}',
    '.markdown-reading {color:var(--secret)}',
    '.markdown-reading a {position:fixed}',
    '.markdown-reading {font-size:999px}',
    '.markdown-reading {color:red} invalid',
    '.markdown-reading [data-secret] {color:red}',
  ])
    expect(() => compileReadingCss(css, 'note-1')).toThrow();
  expect(safeReadingSnippet('.markdown-reading {color:red}')).toContain('color:red');
  expect(safeReadingSnippet('button {display:none}')).toBe('');
});
