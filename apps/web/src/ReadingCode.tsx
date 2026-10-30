import { useMemo, useState, type ReactNode } from 'react';
import { common, createLowlight } from 'lowlight';
const highlight = createLowlight(common);
interface Token {
  type: string;
  value?: string;
  children?: Token[];
  properties?: { className?: unknown };
}
function tokens(nodes: Token[]): ReactNode {
  return nodes.map((node, index) =>
    node.type === 'text' ? (
      node.value
    ) : (
      <span
        key={index}
        className={
          Array.isArray(node.properties?.className)
            ? node.properties.className
                .filter(
                  (item): item is string => typeof item === 'string' && /^hljs-[\w-]+$/.test(item),
                )
                .join(' ')
            : undefined
        }
      >
        {tokens(node.children ?? [])}
      </span>
    ),
  );
}
export function ReadingCode({ value, language }: { value: string; language: string }) {
  const [copied, setCopied] = useState('');
  const content = useMemo(() => {
    if (value.length > 20000 || !highlight.registered(language)) return value;
    try {
      return tokens(highlight.highlight(language, value).children);
    } catch {
      return value;
    }
  }, [value, language]);
  return (
    <div className="reading-code">
      <div className="reading-code-bar">
        <span>{language || 'Plain text'}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied('Copied');
            } catch {
              setCopied('Select the code to copy it.');
            }
          }}
        >
          Copy code
        </button>
        <span role="status">{copied}</span>
      </div>
      <pre>
        <code className={language ? `language-${language}` : undefined}>{content}</code>
      </pre>
    </div>
  );
}
