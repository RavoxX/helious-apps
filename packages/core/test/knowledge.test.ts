import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  createLinkResolver,
  normalizeNotePath,
  normalizeVaultPath,
  parseMarkdown,
  parseSearchQuery,
  resolveRelativePath,
  type IndexedNote,
} from '../src/index.js';

const indexed = (id: string, path: string, markdown = ''): IndexedNote => ({
  id,
  path,
  parsed: parseMarkdown(markdown),
});
describe('Markdown metadata', () => {
  it('extracts typed frontmatter, duplicate headings, nested tags and blocks', () => {
    const note = parseMarkdown(
      '---\ntitle: Custom title\ntags: [Project, "#code/typescript"]\nactive: true\nscore: 3\n---\n# Hello world\n## Hello world\nA useful thought #project #learning/books ^idea-1\n',
    );
    expect(note.title).toBe('Custom title');
    expect(note.properties).toMatchObject({ active: true, score: 3 });
    expect(note.tags).toEqual(['code/typescript', 'learning/books', 'project']);
    expect(note.headings.map((item) => item.slug)).toEqual(['hello-world', 'hello-world-1']);
    expect(note.blocks).toEqual(['idea-1']);
    expect(note.text).not.toContain('score');
    expect(note.wordCount).toBeGreaterThan(5);
  });
  it('preserves source spans and understands aliases, headings, block links and embeds', () => {
    const source =
      '# Start\n[[Projects/Design#Decisions|Design notes]] and ![[Sketch.md#^diagram]]';
    const links = parseMarkdown(source).links;
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      target: 'Projects/Design',
      fragment: 'Decisions',
      alias: 'Design notes',
      line: 2,
      embed: false,
    });
    expect(links[1]).toMatchObject({ target: 'Sketch.md', fragment: '^diagram', embed: true });
    expect(source.slice(links[0]!.start, links[0]!.end)).toBe(
      '[[Projects/Design#Decisions|Design notes]]',
    );
  });
  it('ignores code, escaped wikilinks, HTML and external URLs', () => {
    const note = parseMarkdown(
      '`[[Inline]] #inline`\n\n```md\n[[Fenced]] #fenced\n```\n\n\\[[Escaped]]\n\n<div>[[Html]]</div>\n\n[web](https://example.com) [mail](mailto:x@example.com) [[Real]] #visible',
    );
    expect(note.links.map((link) => link.target)).toEqual(['Real']);
    expect(note.tags).toEqual(['visible']);
    expect(note.text).toContain('[[Fenced]]');
  });
  it('supports relative Markdown references and URL-encoded filenames', () => {
    const note = parseMarkdown(
      '[A](../My%20note.md#A%20heading) ![figure](image.png) [B][ref]\n\n[ref]: ../Hash%23tag.md',
    );
    expect(note.links.map((link) => [link.target, link.fragment, link.embed])).toEqual([
      ['../My note.md', 'A heading', false],
      ['image.png', null, true],
      ['../Hash#tag.md', null, false],
    ]);
  });
  it('contains malformed YAML and recursive alias expansion', () => {
    expect(parseMarkdown('---\na: [broken\n---\n# Still readable').warnings).toHaveLength(1);
    const note = parseMarkdown('---\na: &a [*a]\n---\n# Safe');
    expect(note.properties).toEqual({});
    expect(note.warnings).toHaveLength(1);
    expect(note.title).toBe('Safe');
  });
  it('bounds metadata instead of creating oversized MongoDB documents', () => {
    expect(() => parseMarkdown('[[a]] '.repeat(10001))).toThrow(/metadata limits/);
    expect(() => parseMarkdown('x'.repeat(1000001))).toThrow(/limited/);
  });
});
describe('portable paths and deterministic resolution', () => {
  it.each([
    '../escape.md',
    '/absolute.md',
    'C:\\x.md',
    '.helious/config.md',
    'a//b.md',
    'a/../b.md',
    'NUL.md',
    'a/CON.txt',
    'a/b.',
  ])('rejects unsafe path %s', (path) => expect(() => normalizeVaultPath(path)).toThrow());
  it('normalizes Unicode and permits nested Markdown paths', () => {
    expect(normalizeNotePath('Projects/Cafe\u0301.MD')).toBe('Projects/Café.MD');
    expect(resolveRelativePath('a/b/note.md', '../Other.md')).toBe('a/Other.md');
    expect(resolveRelativePath('a/note.md', '../../Other.md')).toBeNull();
    expect(() => normalizeNotePath('file.txt')).toThrow();
  });
  it('prefers the source folder, then root, then a unique basename; reports ambiguity', () => {
    const notes = [
      indexed('local', 'a/Design.md'),
      indexed('other', 'b/Design.md'),
      indexed('root', 'Root.md'),
      indexed('unique', 'b/Unique.md'),
    ];
    const resolve = createLinkResolver(notes);
    const link = (target: string) => parseMarkdown(`[[${target}]]`).links[0]!;
    expect(resolve('a/Start.md', link('design')).noteId).toBe('local');
    expect(resolve('Start.md', link('Design')).reason).toBe('ambiguous');
    expect(resolve('a/Start.md', link('Root')).noteId).toBe('root');
    expect(resolve('a/Start.md', link('Unique')).noteId).toBe('unique');
    expect(resolve('Start.md', link('../../escape')).reason).toBe('invalid');
  });
  it('resolves heading/block/self links without confusing missing fragments with missing notes', () => {
    const note = indexed('n', 'a/Note.md', '# Architecture\nA block ^decision');
    const resolve = createLinkResolver([note]);
    for (const target of ['#Architecture', '#^decision'])
      expect(resolve(note.path, parseMarkdown(`[[${target}]]`).links[0]!).fragmentExists).toBe(
        true,
      );
    expect(resolve(note.path, parseMarkdown('[[Note#Missing]]').links[0]!)).toMatchObject({
      exists: true,
      fragmentExists: false,
      noteId: 'n',
    });
  });
  it('aggregates repeated edges and retains orphans and unresolved links', () => {
    const graph = buildGraph([
      indexed('a', 'A.md', '[[B]] [[B]] [[Missing]]'),
      indexed('b', 'B.md'),
      indexed('c', 'C.md'),
    ]);
    expect(graph.edges).toEqual([{ source: 'a', target: 'b', count: 2 }]);
    expect(graph.nodes.find((node) => node.id === 'b')).toMatchObject({ incoming: 1, outgoing: 0 });
    expect(graph.nodes.find((node) => node.id === 'c')).toMatchObject({ incoming: 0, outgoing: 0 });
    expect(graph.unresolved).toMatchObject([{ source: 'a', target: 'Missing', reason: 'missing' }]);
  });
});
describe('search syntax', () => {
  it('parses phrases and filters without treating user input as regex', () =>
    expect(
      parseSearchQuery(
        '"design decision" tag:#Code path:"Projects/A B" file:Overview -tag:archive',
      ),
    ).toEqual({
      terms: ['design decision'],
      tags: ['code'],
      paths: ['Projects/A B'],
      files: ['Overview'],
      excludedTags: ['archive'],
    }));
  it.each(['line:10', '/exp.*/i', '-file:foo', 'tag:', 'word '.repeat(17)])(
    'rejects unsupported or excessive query %s',
    (query) => expect(() => parseSearchQuery(query)).toThrow(),
  );
});
