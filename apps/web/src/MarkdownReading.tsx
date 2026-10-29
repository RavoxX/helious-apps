import { useDeferredValue } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { maskSecretReferences } from '@helious/core';

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  url?: string;
}
const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
function wikilinks() {
  return (tree: Node) => {
    const walk = (node: Node) => {
      if (!node.children || ['code', 'inlineCode', 'link', 'image', 'html'].includes(node.type))
        return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value) {
          walk(child);
          return [child];
        }
        const parts: Node[] = [];
        let end = 0;
        for (const match of child.value.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
          if (match.index > end)
            parts.push({ type: 'text', value: child.value.slice(end, match.index) });
          const [target, alias] = match[2]!.split('|');
          parts.push({
            type: 'link',
            url: `#note/${encodeURIComponent(target!)}`,
            children: [{ type: 'text', value: `${match[1] ? '↳ ' : ''}${alias ?? target}` }],
          });
          end = match.index + match[0].length;
        }
        if (end < child.value.length) parts.push({ type: 'text', value: child.value.slice(end) });
        return parts;
      });
    };
    walk(tree);
  };
}
export function MarkdownReading({
  value,
  openLink,
}: {
  value: string;
  openLink: (target: string) => void;
}) {
  const content = maskSecretReferences(useDeferredValue(value)).replace(
    /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
    '',
  );
  return (
    <article className="markdown-reading" aria-label="Reading preview">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, wikilinks]}
        components={{
          a({ href, children }) {
            const wiki = href?.startsWith('#note/');
            const local = wiki || (href && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href));
            return (
              <a
                href={href}
                onClick={
                  local
                    ? (event) => {
                        event.preventDefault();
                        openLink(wiki ? decode(href!.slice(6)) : decode(href!));
                      }
                    : undefined
                }
                rel="noreferrer"
                target={local || href?.startsWith('#') ? undefined : '_blank'}
              >
                {children}
              </a>
            );
          },
          img({ alt }) {
            return (
              <span className="attachment-placeholder">
                Attachment: {alt || 'image'} (inline viewers arrive later)
              </span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {!content.trim() && <p className="reading-empty">Your words will find their shape here.</p>}
    </article>
  );
}
