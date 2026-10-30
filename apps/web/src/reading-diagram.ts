import DOMPurify from 'dompurify';
let queue = Promise.resolve();
export function diagramSourceAllowed(source: string) {
  if (source.length > 16000) throw new Error('Diagrams are limited to 16,000 characters.');
  if (
    !/^\s*(?:%%[^\n]*\n\s*)*(?:flowchart|graph|sequenceDiagram|stateDiagram-v2|classDiagram)\b/.test(
      source,
    )
  )
    throw new Error('Use a flowchart, sequence, state or class diagram.');
  if (
    /%%\s*\{|(?:^|\n)\s*---|@\s*\{|@import|url\s*\(|<(?:[a-z!/])|(?:^|[;\n])\s*(?:click|style|classDef|linkStyle|cssClass)\b/i.test(
      source,
    )
  )
    throw new Error('Diagram configuration, HTML, images, links and custom CSS are disabled.');
  return source;
}
/** Render in strict mode, sanitize, then return an inert image rather than live SVG DOM. */
export async function renderReadingDiagram(
  source: string,
  theme: 'light' | 'dark',
): Promise<string> {
  diagramSourceAllowed(source);
  const render = queue.then(async () => {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 16000,
      maxEdges: 150,
      htmlLabels: false,
      layout: 'dagre',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'Arial, sans-serif',
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'suppressErrorRendering',
        'maxTextSize',
        'maxEdges',
        'htmlLabels',
        'layout',
        'theme',
        'themeVariables',
        'themeCSS',
        'fontFamily',
        'flowchart',
        'sequence',
        'class',
        'state',
      ],
    });
    const host = document.createElement('div');
    host.className = 'reading-diagram-stage';
    host.inert = true;
    host.setAttribute('aria-hidden', 'true');
    document.body.append(host);
    try {
      const { svg } = await mermaid.render(`helious-${crypto.randomUUID()}`, source, host);
      if (svg.length > 2_000_000) throw new Error('Diagram output is too large.');
      const clean = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'a', 'image', 'use', 'script', 'iframe', 'audio', 'video'],
        FORBID_ATTR: ['target'],
      });
      const tree = new DOMParser().parseFromString(clean, 'image/svg+xml');
      if (tree.documentElement.localName !== 'svg' || tree.querySelector('parsererror'))
        throw new Error('Invalid diagram output.');
      for (const element of tree.querySelectorAll('*'))
        for (const attribute of [...element.attributes]) {
          if (
            /^on/i.test(attribute.name) ||
            (/^(?:href|xlink:href|src)$/i.test(attribute.name) &&
              !attribute.value.startsWith('#')) ||
            [...attribute.value.matchAll(/url\s*\(([^)]*)\)/gi)].some(
              (match) =>
                !match[1]!
                  .trim()
                  .replace(/^['"]|['"]$/g, '')
                  .startsWith('#'),
            )
          )
            element.removeAttribute(attribute.name);
        }
      return new XMLSerializer().serializeToString(tree.documentElement);
    } finally {
      host.remove();
    }
  });
  queue = render.then(
    () => undefined,
    () => undefined,
  );
  return render;
}
