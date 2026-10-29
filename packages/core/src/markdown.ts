import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { parseDocument } from 'yaml';

export type PropertyValue =
  string | number | boolean | null | PropertyValue[] | { [key: string]: PropertyValue };
export interface NoteLink {
  target: string;
  fragment: string | null;
  alias: string | null;
  embed: boolean;
  syntax: 'wiki' | 'markdown';
  start: number;
  end: number;
  line: number;
  targetStart?: number;
  targetEnd?: number;
}
export interface Heading {
  text: string;
  slug: string;
  depth: number;
  line: number;
}
export interface ParsedNote {
  title: string | null;
  properties: Record<string, PropertyValue>;
  headings: Heading[];
  blocks: string[];
  tags: string[];
  links: NoteLink[];
  text: string;
  wordCount: number;
  warnings: string[];
}
interface AstNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  depth?: number;
  identifier?: string;
  children?: AstNode[];
  position?: { start: { offset?: number; line: number }; end: { offset?: number; line: number } };
}
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']);
function destinationSpan(raw: string, reference: boolean) {
  let depth = 0;
  let end = -1;
  for (let i = raw.startsWith('!') ? 1 : 0; i < raw.length; i++) {
    if (raw[i] === '\\') {
      i++;
      continue;
    }
    if (raw[i] === '[') depth++;
    if (raw[i] === ']' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0 || raw[end + 1] !== (reference ? ':' : '(')) return null;
  let start = end + 2;
  while (/\s/.test(raw[start] ?? '') && start < raw.length) start++;
  const angle = raw[start] === '<';
  if (angle) start++;
  let finish = start;
  let parentheses = 0;
  for (; finish < raw.length; finish++) {
    const char = raw[finish];
    if (char === '\\') {
      finish++;
      continue;
    }
    if (char === '#' || (angle && char === '>')) break;
    if (!angle) {
      if (char === '(') parentheses++;
      if (char === ')' && parentheses-- === 0) break;
      if (/\s/.test(char!)) break;
    }
  }
  return { start, end: finish };
}
export const headingSlug = (value: string) =>
  value
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
const nodeText = (node: AstNode): string =>
  node.value ?? node.alt ?? node.children?.map(nodeText).join('') ?? '';
function safeProperty(value: unknown, depth = 0): value is PropertyValue {
  if (depth > 16) return false;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return value.length <= 1000 && value.every((item) => safeProperty(item, depth + 1));
  return (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length <= 1000 &&
    Object.values(value).every((item) => safeProperty(item, depth + 1))
  );
}
function parseTarget(raw: string) {
  const hash = raw.indexOf('#');
  return {
    target: (hash < 0 ? raw : raw.slice(0, hash)).trim(),
    fragment: hash < 0 ? null : raw.slice(hash + 1).trim(),
  };
}

export function parseMarkdown(source: string): ParsedNote {
  if (source.length > 1_000_000) throw new RangeError('Notes are limited to 1,000,000 characters');
  const tree: AstNode = parser.parse(source);
  const result: ParsedNote = {
    title: null,
    properties: {},
    headings: [],
    blocks: [],
    tags: [],
    links: [],
    text: '',
    wordCount: 0,
    warnings: [],
  };
  const text: string[] = [];
  const tags = new Set<string>();
  const slugs = new Map<string, number>();
  const definitions = new Map<string, AstNode>();
  function findDefinitions(node: AstNode) {
    if (node.type === 'definition' && node.identifier)
      definitions.set(node.identifier.toLowerCase(), node);
    node.children?.forEach(findDefinitions);
  }
  findDefinitions(tree);
  function walk(node: AstNode) {
    if (
      result.links.length > 10000 ||
      result.headings.length > 5000 ||
      result.blocks.length > 10000 ||
      tags.size > 1000
    )
      throw new RangeError(
        'This note exceeds the metadata limits (10,000 links or blocks, 5,000 headings, 1,000 tags)',
      );
    if (node.type === 'yaml') {
      try {
        if ((node.value?.length ?? 0) > 65536) throw new Error('Frontmatter is too large');
        const document = parseDocument(node.value ?? '', { schema: 'core', uniqueKeys: true });
        if (document.errors.length) throw new Error('Malformed YAML frontmatter');
        const value: unknown = document.toJS({ maxAliasCount: 25 });
        if (
          value !== null &&
          (!safeProperty(value) || Array.isArray(value) || typeof value !== 'object')
        )
          throw new Error('Frontmatter must be a bounded property object');
        if (value) result.properties = value as Record<string, PropertyValue>;
      } catch {
        result.warnings.push('Frontmatter could not be parsed safely');
      }
      return;
    }
    if (node.type === 'heading') {
      const value = nodeText(node);
      const base = headingSlug(value);
      const count = slugs.get(base) ?? 0;
      slugs.set(base, count + 1);
      result.headings.push({
        text: value,
        depth: node.depth ?? 1,
        slug: count ? `${base}-${count}` : base,
        line: node.position?.start.line ?? 1,
      });
      if (node.depth === 1 && !result.title) result.title = value;
    }
    if (
      node.type === 'link' ||
      node.type === 'image' ||
      node.type === 'linkReference' ||
      node.type === 'imageReference'
    ) {
      const definition = node.identifier
        ? definitions.get(node.identifier.toLowerCase())
        : undefined;
      const url = node.url ?? definition?.url;
      if (url && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
        const destination = parseTarget(url);
        try {
          destination.target = decodeURIComponent(destination.target);
          if (destination.fragment) destination.fragment = decodeURIComponent(destination.fragment);
        } catch {
          result.warnings.push('A link has malformed URL encoding');
        }
        result.links.push({
          ...destination,
          alias: node.type.startsWith('image') ? (node.alt ?? null) : nodeText(node),
          embed: node.type.startsWith('image'),
          syntax: 'markdown',
          start: node.position?.start.offset ?? 0,
          end: node.position?.end.offset ?? 0,
          line: node.position?.start.line ?? 1,
          ...(() => {
            const position = definition?.position ?? node.position;
            const start = position?.start.offset ?? 0;
            const span = destinationSpan(source.slice(start, position?.end.offset), !!definition);
            return span ? { targetStart: start + span.start, targetEnd: start + span.end } : {};
          })(),
        });
      }
    }
    if (node.type === 'code' || node.type === 'inlineCode') {
      text.push(node.value ?? '');
      return;
    }
    if (node.type === 'html' || node.type === 'definition') return;
    if (node.type === 'text') {
      const value = node.value ?? '';
      text.push(value);
      const start = node.position?.start.offset ?? 0;
      // Scan original source so an escaped opening bracket stays ordinary text.
      const raw = source.slice(start, node.position?.end.offset ?? start + value.length);
      const wiki = /(!?)\[\[([^\]\n]+)\]\]/g;
      for (const match of raw.matchAll(wiki)) {
        let escapes = 0;
        for (let i = match.index - 1; i >= 0 && raw[i] === '\\'; i--) escapes++;
        if (escapes % 2) continue;
        const body = match[2]!;
        const separator = body.indexOf('|');
        const destination = separator < 0 ? body : body.slice(0, separator);
        result.links.push({
          ...parseTarget(destination),
          alias: separator < 0 ? null : body.slice(separator + 1).trim(),
          embed: match[1] === '!',
          syntax: 'wiki',
          targetStart:
            start +
            match.index +
            match[1]!.length +
            2 +
            destination.length -
            destination.trimStart().length,
          targetEnd:
            start +
            match.index +
            match[1]!.length +
            2 +
            destination.length -
            destination.trimStart().length +
            parseTarget(destination).target.length,
          start: start + match.index,
          end: start + match.index + match[0].length,
          line: (node.position?.start.line ?? 1) + raw.slice(0, match.index).split('\n').length - 1,
        });
      }
      for (const match of value.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu))
        tags.add(match[1]!.toLowerCase());
      for (const match of value.matchAll(/(?:^|\s)\^([a-zA-Z\d-]+)\s*$/gm))
        result.blocks.push(match[1]!);
    }
    node.children?.forEach(walk);
  }
  walk(tree);
  const propertyTags = result.properties.tags;
  for (const tag of typeof propertyTags === 'string'
    ? propertyTags.split(/[,\s]+/)
    : Array.isArray(propertyTags)
      ? propertyTags
      : []) {
    if (typeof tag === 'string' && /^#?[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(tag))
      tags.add(tag.replace(/^#/, '').toLowerCase());
  }
  result.tags = [...tags].sort();
  if (
    result.links.length > 10000 ||
    result.headings.length > 5000 ||
    result.blocks.length > 10000 ||
    result.tags.length > 1000
  )
    throw new RangeError(
      'This note exceeds the metadata limits (10,000 links or blocks, 5,000 headings, 1,000 tags)',
    );
  result.text = text.join(' ').replace(/\s+/g, ' ').trim();
  result.wordCount = result.text.match(/\p{L}[\p{L}\p{N}'’-]*|\p{N}+/gu)?.length ?? 0;
  if (typeof result.properties.title === 'string') result.title = result.properties.title;
  return result;
}
