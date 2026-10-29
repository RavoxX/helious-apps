// Bundle exact dependency license/notice texts with each native distribution.
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];
if (!['x86_64-pc-windows-msvc', 'aarch64-apple-darwin'].includes(platform))
  throw Error('Specify the native distribution target.');
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--format-version',
      '1',
      '--manifest-path',
      join(root, 'Cargo.toml'),
      '--filter-platform',
      platform,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  ),
);
const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
const packages = new Map(metadata.packages.map((p) => [p.id, p]));
const included = new Set();
function visit(id) {
  if (included.has(id)) return;
  included.add(id);
  for (const dep of nodes.get(id)?.deps ?? [])
    if (dep.dep_kinds.some((k) => k.kind !== 'dev')) visit(dep.pkg);
}
for (const p of metadata.packages)
  if (p.name === (platform.includes('windows') ? 'helious-windows' : 'helious-native')) visit(p.id);
let output = '# Helious native — license and third-party notices\n\n';
output += await readFile(join(root, '..', '..', 'NOTICE'), 'utf8');
output += '\n\n' + (await readFile(join(root, '..', '..', 'LICENSE'), 'utf8')) + '\n\n';
output +=
  'Dependency licenses below apply to their respective components. Helious Apps itself uses Apache 2.0 as shown above. Build-time dependencies may also be listed.\n\n';
for (const p of [...included]
  .map((id) => packages.get(id))
  .filter((p) => p.source)
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const directory = dirname(p.manifest_path);
  let names = (await readdir(directory)).filter((n) =>
    /^(licen[sc]e|copying|notice)([._-]|$)/i.test(n),
  );
  if (p.license_file && !names.includes(p.license_file)) names.push(p.license_file);
  const texts = [];
  for (const name of names.sort()) {
    try {
      const text = await readFile(join(directory, name), 'utf8');
      if (text.length && text.length < 1024 * 1024) texts.push(`${name}\n\n${text.trim()}`);
    } catch (e) {
      if (e.code !== 'EISDIR') throw e;
    }
  }
  // Some workspace crates omit root license files from their .crate archive.
  // These checked-in copies identify the upstream commit they came from.
  try {
    texts.push(
      await readFile(join(root, 'licenses', 'crates', `${p.name}-${p.version}.txt`), 'utf8'),
    );
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (p.name === 'epaint_default_fonts') {
    for (const name of (await readdir(join(directory, 'fonts')))
      .filter((n) => n.endsWith('.txt'))
      .sort())
      texts.push(`fonts/${name}\n\n${await readFile(join(directory, 'fonts', name), 'utf8')}`);
  }
  if (!texts.length)
    throw Error(
      `Missing bundled license text for ${p.name} ${p.version}; review its source before release.`,
    );
  output += `## ${p.name} ${p.version}\n\n${p.license ?? 'License: see text below'}\n${p.repository ?? ''}\n\n${texts.join('\n\n')}\n\n---\n\n`;
}
if (platform.includes('apple')) {
  const license = await readFile(join(root, 'licenses', 'Sparkle-2.10.1.txt'), 'utf8');
  output += `## Sparkle 2.10.1\n\nhttps://github.com/sparkle-project/Sparkle/tree/2.10.1\n\n${license}\n`;
}
await mkdir(join(root, 'target'), { recursive: true });
await writeFile(join(root, 'target', 'THIRD-PARTY-NOTICES.txt'), output);
console.log(`Prepared dependency notices for ${platform}.`);
