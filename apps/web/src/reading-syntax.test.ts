import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { expect, it } from 'vitest';
import { readingAnchors, readingSyntax } from './reading-syntax';
import { diagramSourceAllowed } from './reading-diagram';
const render = (source: string, scope = 'test') =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, {
      skipHtml: true,
      children: source,
      remarkPlugins: [remarkGfm, remarkMath, [readingSyntax, { scope }]],
      remarkRehypeOptions: { clobberPrefix: `${scope}-` },
      rehypePlugins: [[readingAnchors, { scope }]],
    }),
  );
it('keeps escaped wikilinks, code and HTML inert while converting links and bounded embeds', () => {
  const html = render(
    '[[Plan|Alias]] ![[Plan#Heading]] \\[[Literal]] `[[Code]]`\n\n```md\n![[Not an embed]]\n```\n\n<img src="https://example.com/tracker">',
  );
  expect(html).toContain('href="#note/Plan"');
  expect(html).toContain('src="#embed/Plan%23Heading"');
  expect(html).not.toContain('#note/Literal');
  expect(html).not.toContain('#note/Code');
  expect(html).not.toContain('https://example.com');
  expect(
    render(Array.from({ length: 20 }, (_, i) => `![[Note ${i}]]`).join('\n\n')).match(/<img /g),
  ).toHaveLength(12);
  expect(
    render(Array.from({ length: 20 }, () => '![x](image.png)').join('\n\n')).match(/<img /g),
  ).toHaveLength(12);
});
it('retains callout bodies, inline formatting and collapse intent', () => {
  const html = render(
    '> [!TIP]- **Remember**\n> Keep the body.\n>\n> - A task\n\n> [!UNKNOWN] Ordinary quote',
  );
  expect(html).toContain('data-callout="tip"');
  expect(html).toContain('data-collapse="closed"');
  expect(html).toContain('<strong>Remember</strong>');
  expect(html).toContain('Keep the body.');
  expect(html).toContain('A task');
  expect(html).toContain('[!UNKNOWN]');
});
it('gives headings and footnotes unique pane-scoped IDs and bounds math processing', () => {
  const source = '# Heading\n\n# Heading\n\nNote[^one]\n\n[^one]: A footnote';
  const first = render(source, 'pane-a'),
    second = render(source, 'pane-b');
  expect(first).toContain('id="pane-a-heading"');
  expect(first).toContain('id="pane-a-heading-1"');
  expect(second).toContain('id="pane-b-fn-one"');
  const ids = (html: string) => [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  expect(ids(first).filter((id) => ids(second).includes(id))).toEqual([]);
  expect(first).toContain('aria-describedby="pane-a-footnote-label"');
  expect(render('$' + 'x'.repeat(4001) + '$')).not.toContain('math-inline');
});
it('rejects diagram directives, active content, external assets and excessive input', () => {
  expect(diagramSourceAllowed('flowchart LR\n A[Notes] --> B[Memory]')).toContain('flowchart');
  for (const source of [
    '---\nconfig: x\n---\ngraph LR;A-->B',
    'graph LR\n%%{init: {securityLevel: loose}}%%\nA-->B',
    'graph LR\nA[<img src=x>]',
    'graph LR\nA@{img:"https://example.com/a.png"}',
    'graph LR\nclick A "https://example.com"',
    'graph LR\nclassDef x fill:url(https://example.com)',
    'graph LR\n' + 'A'.repeat(16000),
  ])
    expect(() => diagramSourceAllowed(source)).toThrow();
});
