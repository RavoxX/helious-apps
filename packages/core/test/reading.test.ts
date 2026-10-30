import { expect, it } from 'vitest';
import { detectReadingMedia, readingFragment, resolveReadingFile } from '../src/reading.js';

it('resolves root, relative, encoded and unambiguous wiki embeds within one Space only', () => {
  const files = [
    { id: 'a', path: 'Projects/Plan.md', spaceId: 'code' },
    { id: 'b', path: 'Images/A photo.png', spaceId: 'code' },
    { id: 'private', path: 'Journal.md', spaceId: 'personal' },
    { id: 'c', path: 'Other/Plan.md', spaceId: 'code' },
  ];
  expect(
    resolveReadingFile('Projects/Overview.md', 'Plan#Design', 'wiki', 'code', files)?.file.id,
  ).toBe('a');
  expect(
    resolveReadingFile('Projects/Overview.md', '../Images/A%20photo.png', 'markdown', 'code', files)
      ?.file.id,
  ).toBe('b');
  expect(
    resolveReadingFile('Overview.md', '/Projects/Plan#^decision', 'wiki', 'code', files)?.fragment,
  ).toBe('^decision');
  for (const target of [
    'Journal',
    '../outside.md',
    'https://example.com/a.png',
    '//example.com/x',
    'data:image/svg+xml,bad',
    'C:\\outside.png',
    'Plan',
  ])
    expect(resolveReadingFile('Overview.md', target, 'wiki', 'code', files)).toBeNull();
  expect(resolveReadingFile('Overview.md', '%E0%A4%A', 'markdown', 'code', files)).toBeNull();
});
it('extracts heading sections and block references while excluding code/frontmatter lookalikes', () => {
  const source =
    '---\nprivate: ^fake\n---\n# Project\n\n## Design\n\nUse Markdown. ^decision\n\n### Detail\n\nKeep history.\n\n## Other\n\n```md\n# Ghost\nnot a block ^hidden\n```\n\n> A quoted block\n\n^quote\n';
  expect(readingFragment(source, 'Design')).toBe(
    '## Design\n\nUse Markdown. ^decision\n\n### Detail\n\nKeep history.\n\n',
  );
  expect(readingFragment(source, '^decision')).toBe('Use Markdown.');
  expect(readingFragment(source, '^quote')).toBe('> A quoted block');
  for (const fragment of ['Ghost', '^hidden', '^fake', 'Missing', '^bad.*'])
    expect(readingFragment(source, fragment)).toBeNull();
  expect(readingFragment('A ^same\n\nB ^same', '^same')).toBeNull();
  expect(() => readingFragment('x'.repeat(100001), null)).toThrow('large');
});
it('accepts only supported passive media signatures, not declared names or active markup', () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 100);
  view.setUint32(20, 80);
  expect(detectReadingMedia(png)).toEqual({ kind: 'image', mime: 'image/png' });
  view.setUint32(16, 8193);
  expect(() => detectReadingMedia(png)).toThrow('dimensions');
  view.setUint32(16, 8192);
  view.setUint32(20, 8192);
  expect(() => detectReadingMedia(png)).toThrow('16-million');
  const encode = (value: string) => new TextEncoder().encode(value);
  expect(detectReadingMedia(encode('%PDF-1.7'))?.kind).toBe('pdf');
  expect(detectReadingMedia(encode('RIFFxxxxWAVEfmt '))?.mime).toBe('audio/wav');
  expect(detectReadingMedia(encode('ID3xxxx'))?.mime).toBe('audio/mpeg');
  expect(detectReadingMedia(encode('OggSxxxx'))?.mime).toBe('audio/ogg');
  for (const source of [
    '<svg onload="alert(1)"/>',
    '<html>not an image</html>',
    '',
    'a plain file',
  ])
    expect(detectReadingMedia(encode(source))).toBeNull();
});
