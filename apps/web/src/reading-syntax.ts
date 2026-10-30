import { headingSlug } from '@helious/core';

export interface ReadingNode {
  type: string;
  value?: string;
  lang?: string | null;
  depth?: number;
  url?: string;
  alt?: string;
  children?: ReadingNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: Record<string, unknown>; [key: string]: unknown };
  properties?: Record<string, unknown>;
}

/** Footnote label IDs are fixed by mdast-to-hast unless scoped separately. */
export function readingAnchors({ scope = 'reading' }: { scope?: string } = {}) {
  return (tree: ReadingNode) => {
    const walk = (node: ReadingNode) => {
      const props = node.properties;
      if (props?.id === 'footnote-label') props.id = `${scope}-footnote-label`;
      for (const key of ['ariaDescribedBy', 'aria-describedby']) {
        const value = props?.[key];
        if (Array.isArray(value))
          props![key] = value.map((id) =>
            id === 'footnote-label' ? `${scope}-footnote-label` : id,
          );
        else if (value === 'footnote-label') props![key] = `${scope}-footnote-label`;
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
const callouts = new Set([
  'note',
  'info',
  'tip',
  'warning',
  'danger',
  'success',
  'question',
  'example',
  'quote',
  'bug',
]);
/** Only AST transformations: user HTML is never enabled. */
export function readingSyntax({ scope = 'reading' }: { scope?: string } = {}) {
  return (tree: ReadingNode, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : '';
    let embeds = 0,
      formulas = 0,
      formulaCharacters = 0,
      nodes = 0;
    const headings = new Map<string, number>();
    const text = (node: ReadingNode): string =>
      node.value ?? node.children?.map(text).join('') ?? '';
    function walk(node: ReadingNode, depth = 0) {
      if (++nodes > 25000 || depth > 40) throw new Error('Preview structure limit');
      if (node.type === 'image' && ++embeds > 12) {
        node.type = 'text';
        node.value = `Attachment omitted: ${node.alt ?? 'file'} (12-embed preview limit).`;
        delete node.url;
        delete node.alt;
      }
      if (node.type === 'heading') {
        const slug = headingSlug(text(node));
        const count = headings.get(slug) ?? 0;
        headings.set(slug, count + 1);
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            id: `${scope}-${slug}${count ? `-${count}` : ''}`,
          },
        };
      }
      if (
        node.type === 'math' ||
        node.type === 'inlineMath' ||
        (node.type === 'code' && node.lang === 'math')
      ) {
        formulas++;
        formulaCharacters += node.value?.length ?? 0;
        if (formulas > 80 || (node.value?.length ?? 0) > 4000 || formulaCharacters > 20000) {
          node.type = node.type === 'inlineMath' ? 'inlineCode' : 'code';
          node.lang = 'text';
          node.data = {};
        }
      }
      if (['code', 'inlineCode', 'math', 'inlineMath', 'link', 'image', 'html'].includes(node.type))
        return;
      if (node.type === 'blockquote') {
        const paragraph = node.children?.[0];
        const first = paragraph?.children?.[0];
        const marker =
          first?.type === 'text' ? /^\[!(\w+)\]([+-])?[\t ]*/.exec(first.value ?? '') : null;
        const kind = marker?.[1]?.toLowerCase();
        if (marker && kind && callouts.has(kind) && paragraph) {
          const header: ReadingNode[] = [],
            body: ReadingNode[] = [];
          let lineEnded = false;
          const parts = paragraph.children!.map((part, index) =>
            index === 0 ? { ...part, value: part.value!.slice(marker[0].length) } : part,
          );
          for (const part of parts) {
            if (lineEnded) {
              body.push(part);
              continue;
            }
            const newline = part.type === 'text' ? (part.value ?? '').indexOf('\n') : -1;
            if (part.type === 'break') {
              lineEnded = true;
              continue;
            }
            if (newline < 0) header.push(part);
            else {
              header.push({ ...part, value: part.value!.slice(0, newline) });
              body.push({ ...part, value: part.value!.slice(newline + 1) });
              lineEnded = true;
            }
          }
          if (!header.some((part) => text(part).trim()))
            header.push({ type: 'text', value: kind[0]!.toUpperCase() + kind.slice(1) });
          node.children = [
            { type: 'paragraph', children: header },
            ...(body.some((part) => text(part).trim())
              ? [{ type: 'paragraph', children: body }]
              : []),
            ...node.children!.slice(1),
          ];
          node.data = {
            ...node.data,
            hProperties: {
              'data-callout': kind,
              'data-collapse': marker[2] === '-' ? 'closed' : marker[2] === '+' ? 'open' : 'none',
            },
          };
        }
      }
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value) {
          walk(child, depth + 1);
          return [child];
        }
        const result: ReadingNode[] = [];
        let end = 0,
          rawCursor = 0;
        const raw = source.slice(
          child.position?.start.offset ?? 0,
          child.position?.end.offset ?? 0,
        );
        for (const match of child.value.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
          const rawIndex = raw.indexOf(match[0], rawCursor);
          if (rawIndex < 0 && raw) continue;
          rawCursor = rawIndex + match[0].length;
          let escapes = 0;
          for (let index = rawIndex - 1; index >= 0 && raw[index] === '\\'; index--) escapes++;
          if (escapes % 2) continue;
          if (match.index > end)
            result.push({ type: 'text', value: child.value.slice(end, match.index) });
          const separator = match[2]!.indexOf('|');
          const target = (separator < 0 ? match[2]! : match[2]!.slice(0, separator)).trim();
          const alias = separator < 0 ? target : match[2]!.slice(separator + 1).trim();
          if (match[1] && ++embeds <= 12)
            result.push({ type: 'image', url: `#embed/${encodeURIComponent(target)}`, alt: alias });
          else
            result.push({
              type: 'link',
              url: `#note/${encodeURIComponent(target)}`,
              children: [{ type: 'text', value: `${match[1] ? 'Open embed: ' : ''}${alias}` }],
            });
          end = match.index + match[0].length;
        }
        if (end < child.value.length) result.push({ type: 'text', value: child.value.slice(end) });
        return result;
      });
    }
    try {
      walk(tree);
    } catch {
      tree.children = [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: 'This preview is too complex. Use Source mode to read and edit it.',
            },
          ],
        },
      ];
    }
  };
}
