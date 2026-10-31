import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, basename } from 'node:path';
const repository = 'RavoxX/helious-apps';
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version;
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${version}` || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag ?? ''))
  throw Error('Release tag must match the desktop version.');
for (const crate of ['engine', 'windows']) {
  const cargo = await readFile(new URL(`../${crate}/Cargo.toml`, import.meta.url), 'utf8');
  if (!new RegExp(`^version = "${version.replaceAll('.', '\\.')}"$`, 'm').test(cargo))
    throw Error('Native package versions must match the release tag.');
}
if (process.argv[2] === 'validate') {
  console.log(`Validated ${tag}`);
  process.exit(0);
}
const directory = resolve(process.argv[3] ?? 'installers');
const files = (await readdir(directory, { recursive: true }))
  .filter((file) => /\.(exe|msi|dmg|zip)$/.test(file))
  .sort();
if (
  files.length !== 4 ||
  new Set(files.map((f) => f.split('.').at(-1))).size !== 4 ||
  files.some((file) => !basename(file).startsWith(`Helious_${version}_`))
)
  throw Error('Expected one matching Windows EXE, MSI, universal macOS DMG and ZIP.');
const rawPrivate = process.env.HELIOUS_UPDATE_PRIVATE_KEY;
if (!rawPrivate)
  throw Error('Configure HELIOUS_UPDATE_PRIVATE_KEY in GitHub Actions secrets before releasing.');
const key = createPrivateKey(rawPrivate);
const expectedPublic = (
  await readFile(new URL('../update-public-key.txt', import.meta.url), 'utf8')
).trim();
if (
  createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') !==
  expectedPublic
)
  throw Error('Update-signing key does not match the embedded public key.');
const assets = [];
for (const file of files) {
  const bytes = await readFile(join(directory, file));
  if (!bytes.length) throw Error('Empty installer');
  assets.push({
    file,
    name: basename(file),
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  });
}
const base = `https://github.com/${repository}/releases/download/${tag}`;
const entry = (extension) => {
  const item = assets.find((a) => a.name.endsWith(extension));
  return { url: `${base}/${item.name}`, sha256: item.sha256, size: item.size };
};
const manifest = {
  schema: 1,
  version,
  notes:
    'Native authoring, Canvas, rich reading/media, permission-reviewed draft extensions and signed updates.',
  windows: entry('.exe'),
  macos: entry('.zip'),
};
const metadata = Buffer.from(JSON.stringify(manifest) + '\n');
await writeFile(join(directory, 'update.json'), metadata);
await writeFile(
  join(directory, 'update.json.sig'),
  sign(null, Buffer.concat([Buffer.from('helious-update-v1\n'), metadata]), key).toString(
    'base64',
  ) + '\n',
);
const archive = assets.find((a) => a.name.endsWith('.zip'));
const archiveSignature = sign(null, archive.bytes, key).toString('base64');
await writeFile(
  join(directory, 'appcast.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel>
<title>Helious native updates</title><item><title>Helious ${version}</title>
<pubDate>${new Date().toUTCString()}</pubDate><sparkle:version>${version}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString>
<sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
<description>Native authoring, Canvas, rich reading and permission-reviewed draft extensions.</description>
<enclosure url="${base}/${archive.name}" sparkle:edSignature="${archiveSignature}" length="${archive.size}" type="application/zip"/>
</item></channel></rss>\n`,
);
const sums = assets.map((a) => `${a.sha256}  ${a.name}`);
for (const name of ['update.json', 'update.json.sig', 'appcast.xml'])
  sums.push(
    `${createHash('sha256')
      .update(await readFile(join(directory, name)))
      .digest('hex')}  ${name}`,
  );
await writeFile(join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
const notes = join(directory, 'release-notes.md');
await writeFile(
  notes,
  `Helious ${version}: native desktop preview.\n\nmacOS refreshes GitHub release discovery every fifteen minutes while automatic checks are enabled, keeping long-running apps from staying on their startup feed. Sparkle retains its check/download schedule.\n\nThis patch includes the 0.9.1 security fixes: it rejects hidden/generated sync paths before download or local writes, including recovery replay, and updates the native formula renderer for RUSTSEC-2026-0311. Back up first; existing excluded files are left untouched and unsafe old metadata/journals are preserved for review.\n\nWindows uses Rust/egui/eframe with wgpu; macOS uses SwiftUI/AppKit. Both include local Markdown vaults, explicit Cloud/self-hosted sign-in, real-note graph, settings, selected-Space sync and signed updates. Phase 9 adds daily notes/templates, typed YAML properties, guarded JSON Canvas boards, native reading/media and a capability-limited declarative extension API. Browser reading CSS snippets are scoped to note content. See the guides for native syntax and UI differences.\n\nCloud defaults to https://helious.work, which is not live yet; local folders and self-hosting work independently.\n\nDownload Windows x64 EXE or MSI, or universal macOS DMG (macOS 14+). ZIP is the macOS updater archive. SHA256SUMS.txt lists file hashes.\n\nUpdate signatures are configured. Windows Authenticode and macOS Developer ID/notarization are not configured; operating systems may warn or block installation. Install this native version once manually; old 0.8.0 apps cannot self-update. Back up vaults including .helious/ before upgrading.\n\n[Desktop guide](https://github.com/${repository}/blob/${tag}/apps/docs/desktop.md). Advanced server security/token management remains available through the browser account panel while native feature parity develops.\n`,
);
const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let existing;
try {
  existing = JSON.parse(gh('release', 'view', tag, '--json', 'isDraft'));
} catch (error) {
  if (!String(error.stderr).includes('release not found')) throw error;
}
if (existing && !existing.isDraft)
  throw Error(
    'Release already published; create a new version rather than replacing published installers.',
  );
if (!existing)
  gh(
    'release',
    'create',
    tag,
    '--verify-tag',
    '--draft',
    '--title',
    `Helious ${version}`,
    '--notes-file',
    notes,
    ...(version.startsWith('0.') || version.includes('-') ? ['--prerelease'] : []),
  );
gh(
  'release',
  'upload',
  tag,
  ...assets.map((a) => join(directory, a.file)),
  ...['update.json', 'update.json.sig', 'appcast.xml', 'SHA256SUMS.txt'].map((n) =>
    join(directory, n),
  ),
  '--clobber',
);
gh('release', 'edit', tag, '--draft=false');
console.log(gh('release', 'view', tag, '--json', 'url', '--jq', '.url'));
