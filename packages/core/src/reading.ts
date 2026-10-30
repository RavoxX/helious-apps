import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { createLinkResolver } from './graph.js';
import { headingSlug } from './markdown.js';

export interface ReadingFile {
  id: string;
  path: string;
  spaceId: string;
}
/** Reading embeds deliberately resolve only within the containing note's Space. */
export function resolveReadingFile(
  from: string,
  raw: string,
  syntax: 'wiki' | 'markdown',
  spaceId: string,
  files: ReadingFile[],
) {
  let decoded = raw;
  if (syntax === 'markdown') {
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  const hash = decoded.indexOf('#');
  const target = hash < 0 ? decoded : decoded.slice(0, hash);
  const fragment = hash < 0 ? null : decoded.slice(hash + 1);
  const candidates = files.filter((file) => file.spaceId === spaceId);
  const resolve = createLinkResolver(
    candidates.map((file) => ({
      ...file,
      parsed: { title: null, tags: [], links: [], headings: [], blocks: [] },
    })),
  );
  const match = resolve(from, {
    target,
    fragment,
    alias: null,
    syntax,
    embed: true,
    start: 0,
    end: 0,
    line: 1,
  });
  const file = candidates.find((file) => file.id === match.noteId);
  return file ? { file, fragment } : null;
}

interface FragmentNode {
  type: string;
  value?: string;
  depth?: number;
  children?: FragmentNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
const fragmentParser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']);
const text = (node: FragmentNode): string => node.value ?? node.children?.map(text).join('') ?? '';
export function readingFragment(source: string, fragment: string | null): string | null {
  if (source.length > 100_000)
    throw new Error(
      'Open this large note directly; inline note embeds are limited to 100,000 characters.',
    );
  if (!fragment) return source;
  const tree = fragmentParser.parse(source) as FragmentNode;
  if (!fragment.startsWith('^')) {
    const nodes = tree.children ?? [];
    const index = nodes.findIndex(
      (node) => node.type === 'heading' && headingSlug(text(node)) === headingSlug(fragment),
    );
    if (index < 0) return null;
    const start = nodes[index]!;
    const end = nodes
      .slice(index + 1)
      .find((node) => node.type === 'heading' && node.depth! <= start.depth!);
    return source.slice(start.position!.start.offset, end?.position?.start.offset);
  }
  const matches: string[] = [];
  const id = fragment.slice(1);
  if (!/^[\w-]+$/.test(id)) return null;
  const walk = (parent: FragmentNode) => {
    for (const [index, node] of (parent.children ?? []).entries()) {
      if (['code', 'inlineCode', 'yaml'].includes(node.type)) continue;
      if (node.type === 'paragraph' && new RegExp(`(?:^|[\\t ])\\^${id}\\s*$`).test(text(node))) {
        const block =
          text(node).trim() === `^${id}`
            ? parent.children?.[index - 1]
            : parent.type === 'listItem'
              ? parent
              : node;
        if (block && block.type !== 'yaml')
          matches.push(
            source
              .slice(block.position!.start.offset, block.position!.end.offset)
              .replace(new RegExp(`[\\t ]*\\^${id}\\s*$`), ''),
          );
      } else walk(node);
    }
  };
  walk(tree);
  return matches.length === 1 ? matches[0]! : null;
}

export type ReadingMedia = { kind: 'image' | 'audio' | 'pdf'; mime: string };
const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
/** Never trust an upload's extension or declared MIME to select an active viewer. */
export function detectReadingMedia(bytes: Uint8Array): ReadingMedia | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dimensions: [number, number] | undefined;
  let mime = '';
  if (bytes.length >= 24 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') {
    mime = 'image/png';
    dimensions = [data.getUint32(16), data.getUint32(20)];
  } else if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) {
    mime = 'image/gif';
    dimensions = [data.getUint16(6, true), data.getUint16(8, true)];
  } else if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    mime = 'image/webp';
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X')
      dimensions = [
        1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
        1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
      ];
    else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = data.getUint32(21, true);
      dimensions = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    } else if (chunk === 'VP8 ' && ascii(bytes, 23, 3) === '\x9d\x01\x2a')
      dimensions = [data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff];
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mime = 'image/jpeg';
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1]!;
      offset += 2;
      if (marker === 0xff) {
        offset--;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 8
      ) {
        dimensions = [data.getUint16(offset + 5), data.getUint16(offset + 3)];
        break;
      }
      offset += length;
    }
  }
  if (mime) {
    if (
      !dimensions ||
      dimensions.some((value) => value < 1 || value > 8192) ||
      dimensions[0] * dimensions[1] > 16_000_000
    )
      throw new Error(
        'Image dimensions are invalid or exceed the 16-million-pixel / 8,192-pixel-side preview limit.',
      );
    return { kind: 'image', mime };
  }
  if (ascii(bytes, 0, 5) === '%PDF-') return { kind: 'pdf', mime: 'application/pdf' };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE')
    return { kind: 'audio', mime: 'audio/wav' };
  if (ascii(bytes, 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg' };
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
    return { kind: 'audio', mime: 'audio/mpeg' };
  return null;
}
