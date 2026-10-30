import {
  Children,
  isValidElement,
  lazy,
  Suspense,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { headingSlug, maskSecretReferences, resolveReadingFile } from '@helious/core';
import { readingAnchors, readingSyntax } from './reading-syntax';
import { ReadingCode } from './ReadingCode';
import { ReadingEmbed } from './ReadingEmbed';
import type { ReadingContext } from './reading-files';
import 'katex/dist/katex.min.css';
import './reading.css';
const ReadingDiagram = lazy(() =>
  import('./ReadingDiagram').then((module) => ({ default: module.ReadingDiagram })),
);
const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const nodeText = (node: { value?: string; children?: readonly unknown[] }): string =>
  node.value ??
  (node.children ?? []).map((child) => nodeText(child as Parameters<typeof nodeText>[0])).join('');

export function MarkdownReading({
  value,
  openLink,
  context,
  allowEmbeds = true,
}: {
  value: string;
  openLink: (target: string) => void;
  context?: ReadingContext;
  allowEmbeds?: boolean;
}) {
  const deferred = useDeferredValue(value);
  const scope = `reading-${useId().replace(/[^\w-]/g, '')}`;
  const article = useRef<HTMLElement>(null);
  const latest = useRef({ openLink, context, allowEmbeds });
  latest.current = { openLink, context, allowEmbeds };
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        if (!href) return <span>{children}</span>;
        const wiki = href.startsWith('#note/');
        const local = wiki || !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href);
        return (
          <a
            href={href}
            rel="noreferrer"
            target={local || href.startsWith('#') ? undefined : '_blank'}
            onClick={
              local || href.startsWith('#')
                ? (event) => {
                    event.preventDefault();
                    if (href.startsWith('#') && !wiki) {
                      const fragment = decode(href.slice(1));
                      const target = [...(article.current?.querySelectorAll('[id]') ?? [])].find(
                        (element) =>
                          element.id === fragment ||
                          element.id === `${scope}-${headingSlug(fragment)}`,
                      );
                      if (target) {
                        target.scrollIntoView({ block: 'start' });
                        if (target instanceof HTMLElement) {
                          target.tabIndex = -1;
                          target.focus({ preventScroll: true });
                        }
                      }
                      return;
                    }
                    const raw = wiki ? decode(href.slice(6)) : href;
                    const ctx = latest.current.context;
                    const resolved = ctx
                      ? resolveReadingFile(
                          ctx.path,
                          raw,
                          wiki ? 'wiki' : 'markdown',
                          ctx.spaceId,
                          ctx.notes,
                        )
                      : null;
                    latest.current.openLink(
                      resolved
                        ? `/${resolved.file.path}${resolved.fragment ? `#${resolved.fragment}` : ''}`
                        : wiki
                          ? raw
                          : decode(raw),
                    );
                  }
                : undefined
            }
          >
            {children}
          </a>
        );
      },
      img({ src, alt }) {
        const wiki = src?.startsWith('#embed/');
        return (
          <ReadingEmbed
            raw={wiki ? decode(src!.slice(7)) : (src ?? '')}
            syntax={wiki ? 'wiki' : 'markdown'}
            alt={alt ?? ''}
            context={latest.current.context}
            openLink={latest.current.openLink}
            allowEmbeds={latest.current.allowEmbeds}
          />
        );
      },
      p({ children, node }) {
        return node?.children.some(
          (child) => child.type === 'element' && child.tagName === 'img',
        ) ? (
          <div className="reading-embed-paragraph">{children}</div>
        ) : (
          <p>{children}</p>
        );
      },
      pre({ node }) {
        const code = node?.children.find(
          (child) => child.type === 'element' && child.tagName === 'code',
        );
        const language =
          code?.type === 'element' && Array.isArray(code.properties.className)
            ? (code.properties.className
                .find((item) => typeof item === 'string' && item.startsWith('language-'))
                ?.toString()
                .slice(9) ?? '')
            : '';
        const source = code ? nodeText(code).replace(/\n$/, '') : '';
        return language === 'mermaid' ? (
          <Suspense fallback={<p role="status">Preparing diagram…</p>}>
            <ReadingDiagram source={source} />
          </Suspense>
        ) : (
          <ReadingCode language={language} value={source} />
        );
      },
      blockquote({ node, children }) {
        const kind = node?.properties['data-callout'];
        if (typeof kind !== 'string') return <blockquote>{children}</blockquote>;
        const parts = Children.toArray(children).filter(
          (part) => typeof part !== 'string' || part.trim(),
        );
        const first = parts.shift();
        const title = isValidElement<{ children: ReactNode }>(first) ? first.props.children : first;
        const collapse = node?.properties['data-collapse'];
        return collapse === 'open' || collapse === 'closed' ? (
          <details className={`reading-callout callout-${kind}`} open={collapse === 'open'}>
            <summary>{title}</summary>
            <div>{parts}</div>
          </details>
        ) : (
          <aside className={`reading-callout callout-${kind}`} role="note">
            <div className="reading-callout-title">{title}</div>
            <div>{parts}</div>
          </aside>
        );
      },
    }),
    [scope],
  );
  const content = maskSecretReferences(deferred)
    .replace(/^\uFEFF/, '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  return (
    <article ref={article} className="markdown-reading" aria-label="Reading preview">
      {content.length > 250000 ? (
        <p>
          This note exceeds the 250,000-character reading preview limit. Use Source mode to read and
          edit the full note.
        </p>
      ) : (
        <ReactMarkdown
          skipHtml
          remarkPlugins={[
            remarkGfm,
            [remarkMath, { singleDollarTextMath: true }],
            [readingSyntax, { scope }],
          ]}
          remarkRehypeOptions={{ clobberPrefix: `${scope}-` }}
          rehypePlugins={[
            [readingAnchors, { scope }],
            [rehypeKatex, { trust: false, maxExpand: 500, maxSize: 20, strict: 'error' }],
          ]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      )}
      {!content.trim() && <p className="reading-empty">Your words will find their shape here.</p>}
    </article>
  );
}
