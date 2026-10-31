import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Keep VitePress's two early theme/platform checks compatible with script-src 'self'. */
export function externalizeThemeScripts(html: string, outDir: string, base: string) {
  return html.replace(
    /<script id="(check-dark-mode|check-mac-os)">([\s\S]*?)<\/script>/g,
    (_tag: string, id: string, source: string) => {
      const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
      const filename = `${id}.${hash}.js`;
      const directory = join(outDir, 'assets');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, filename), source);
      // Preserve blocking execution before the app mounts, including appearance restoration.
      return `<script id="${id}" src="${base}assets/${filename}"></script>`;
    },
  );
}
