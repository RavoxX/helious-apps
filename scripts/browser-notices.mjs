import { createRequire } from 'node:module';
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const mode = process.argv[2] ?? 'browser';
if (!['browser', 'server', 'docs'].includes(mode)) throw new Error('Unknown notice target.');
const root = fileURLToPath(
  new URL(`../apps/${mode === 'browser' ? 'web' : mode}/`, import.meta.url),
);
const entry = join(root, 'package.json');
const pending = [mode === 'docs' ? dependencyFile('vitepress', entry) : entry];
const visited = new Set();
const notices = new Map();
const missing = [];
const fallbackRoot = fileURLToPath(new URL('./licenses/', import.meta.url));
const fallbackSources = JSON.parse(readFileSync(join(fallbackRoot, 'sources.json'), 'utf8'));
const fallbackFiles = {
  'standardwebhooks@1.1.1': 'standardwebhooks-1.1.1.txt',
  '@algolia/autocomplete-core@1.17.7': 'algolia-autocomplete-1.17.7.txt',
  '@algolia/autocomplete-plugin-algolia-insights@1.17.7': 'algolia-autocomplete-1.17.7.txt',
  '@algolia/autocomplete-preset-algolia@1.17.7': 'algolia-autocomplete-1.17.7.txt',
  '@algolia/autocomplete-shared@1.17.7': 'algolia-autocomplete-1.17.7.txt',
  '@docsearch/css@3.8.2': 'algolia-docsearch-3.8.2.txt',
  '@docsearch/js@3.8.2': 'algolia-docsearch-3.8.2.txt',
  '@docsearch/react@3.8.2': 'algolia-docsearch-3.8.2.txt',
  '@iconify-json/simple-icons@1.2.101': 'simple-icons-16.36.0.txt',
};
function dependencyFile(name, parent) {
  const require = createRequire(parent);
  for (const base of require.resolve.paths(name) ?? []) {
    const file = join(base, name, 'package.json');
    if (existsSync(file)) return realpathSync(file);
  }
  try {
    return require.resolve(`${name}/package.json`);
  } catch {
    /* Some export maps hide metadata. */
  }
  let folder = dirname(require.resolve(name));
  while (folder !== dirname(folder)) {
    const file = join(folder, 'package.json');
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === name) return file;
    folder = dirname(folder);
  }
  throw new Error(`Cannot locate dependency metadata: ${name}`);
}
while (pending.length) {
  const file = pending.pop();
  if (visited.has(file)) continue;
  visited.add(file);
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  for (const name of Object.keys(pkg.dependencies ?? {}).sort())
    pending.push(dependencyFile(name, file));
  if (pkg.name.startsWith('@helious/')) continue;
  const key = `${pkg.name}@${pkg.version}`;
  if (notices.has(key)) continue;
  const folder = dirname(file);
  const licenseFiles = readdirSync(folder)
    .filter((name) => /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(name))
    .sort();
  const texts = [];
  for (const name of licenseFiles) {
    try {
      texts.push(`${name}\n${readFileSync(join(folder, name), 'utf8').trim()}`);
    } catch {
      /* A license directory is not a text file. */
    }
  }
  if (!texts.length && fallbackFiles[key]) {
    const name = fallbackFiles[key];
    const bytes = readFileSync(join(fallbackRoot, name));
    const source = fallbackSources[name];
    if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
      throw new Error(`Changed upstream notice: ${name}`);
    texts.push(`Upstream license retained from ${source.source}\n${bytes.toString('utf8').trim()}`);
  }
  if (!texts.length) {
    const readme = readdirSync(folder).find((name) =>
      /^readme(?:\.md|\.markdown|\.txt)?$/i.test(name),
    );
    if (readme && /(?:copyright|licen[cs]e)/i.test(readFileSync(join(folder, readme), 'utf8')))
      texts.push(`${readme}\n${readFileSync(join(folder, readme), 'utf8').trim()}`);
    else missing.push(key);
  }
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const source = (
    repository ??
    pkg.homepage ??
    `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`
  )
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
  notices.set(
    key,
    `${key}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? 'See upstream license')}\nUpstream source: ${source}\nPublished source: https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}\n\n${texts.join('\n\n')}`,
  );
}
if (missing.length)
  throw new Error(`Published dependencies have no license notice: ${missing.sort().join(', ')}`);
const body = `Helious ${mode} dependency notices\n\nUnmodified third-party dependencies reachable from this distribution entry, including dependencies prebundled by upstream packages. This inventory can include modules not used by a particular build and does not assert which optional platform modules are shipped. Retain applicable notices when redistributing; upstream and published-source links identify corresponding source. Third-party licenses remain separate from the Helious source license.\n\n${[
  ...notices.entries(),
]
  .sort(([a], [b]) => a.localeCompare(b, 'en'))
  .map(([, value]) => value)
  .join('\n\n' + '='.repeat(72) + '\n\n')}\n`;
const output = resolve(
  root,
  mode === 'server' ? 'dist/THIRD-PARTY-NOTICES.txt' : 'public/licenses/THIRD-PARTY-NOTICES.txt',
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, body);
console.log(`Bundled notices for ${notices.size} ${mode} dependencies.`);
