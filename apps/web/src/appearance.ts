const properties = new Set([
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-decoration',
  'text-transform',
  'border-color',
  'border-radius',
  'padding',
  'margin-block',
]);
const elements = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'pre',
  'code',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'strong',
  'em',
  'hr',
]);
/** A deliberately small reading-only CSS dialect. Never accepts URLs, at-rules or UI selectors. */
export function compileReadingCss(source: string, scope: string): string {
  if (source.length > 16384 || !/^[a-zA-Z0-9-]+$/.test(scope))
    throw Error('Invalid reading snippet size or scope.');
  if (!source.trim()) return '';
  if (/[\\@<>]|\/\*|\*\//.test(source))
    throw Error('Use plain reading rules without escapes, comments or at-rules.');
  let cursor = 0;
  const output: string[] = [];
  const rules = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(rules)) {
    if (source.slice(cursor, match.index).trim()) throw Error('Invalid reading CSS rule.');
    cursor = match.index + match[0].length;
    const selectors = match[1]!.split(',').map((s) => s.trim());
    for (const selector of selectors) {
      const parts = selector.split(/\s+/);
      if (
        parts.shift() !== '.markdown-reading' ||
        parts.length > 4 ||
        parts.some((p) => !elements.has(p))
      )
        throw Error(
          'Selectors must start with .markdown-reading and use ordinary reading elements.',
        );
    }
    const declarations = match[2]!
      .split(';')
      .filter((d) => d.trim())
      .map((d) => {
        const colon = d.indexOf(':');
        if (colon < 0) throw Error('Use property: value declarations.');
        const property = d.slice(0, colon).trim().toLowerCase(),
          value = d.slice(colon + 1).trim();
        if (!properties.has(property)) throw Error(`Unsupported reading property: ${property}`);
        // No functions except bounded literal rgb/hsl colors; no CSS variables, imports or resource loads.
        if (
          !value ||
          value.length > 120 ||
          !/^[a-zA-Z0-9#.,%() +-]+$/.test(value) ||
          /(?:url|image|expression|var|attr|calc|env|!important)/i.test(value) ||
          (/[()]/.test(value) && !/^(?:rgb|rgba|hsl|hsla)\([\d.,% /]+\)$/.test(value)) ||
          [...value.replace(/#[0-9a-f]{3,8}\b/gi, '').matchAll(/-?\d+(?:\.\d+)?/g)].some(
            (n) =>
              Math.abs(Number(n[0])) >
              (property.includes('color') ? 1000 : property === 'font-weight' ? 900 : 100),
          )
        )
          throw Error(
            `Unsupported value for ${property}. Use simple bounded typography or colors.`,
          );
        return `${property}:${value}`;
      });
    if (declarations.length > 24) throw Error('Use at most 24 declarations per rule.');
    output.push(
      `${selectors.map((s) => `[data-reading-style="${scope}"] ${s}`).join(',')}{${declarations.join(';')}}`,
    );
    if (output.length > 40) throw Error('Use at most 40 reading rules.');
  }
  if (!output.length || source.slice(cursor).trim()) throw Error('Invalid reading CSS rule.');
  return output.join('\n');
}

export function safeReadingSnippet(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    compileReadingCss(value, 'validation');
    return value;
  } catch {
    return '';
  }
}
