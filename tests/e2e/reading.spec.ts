import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';
import { readingPdf, readingWav } from './reading-fixtures.js';
test.use({ extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.94' }, actionTimeout: 15000 });
test('rich reading renders math, callouts, scoped embeds and passive media without external requests', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [],
    external: string[] = [],
    reads: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).origin !== 'http://localhost:3100') external.push(url);
    if (request.method() === 'GET') reads.push(url);
  });
  const email = `reading-${info.project.name}-${Date.now()}@example.com`;
  await page.goto('/app/');
  await page.getByLabel('Your name').fill('Reading tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a synthetic reading passphrase');
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, 'a synthetic reading passphrase');
  await page.getByLabel('New vault name').fill('Reading');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  const vaultId = await page.getByLabel('Current vault').inputValue();
  const spaces = (await (await page.request.get(`/api/vaults/${vaultId}/spaces`)).json()).spaces;
  const code = spaces.find((space: { kind: string }) => space.kind === 'code').id;
  const personal = spaces.find((space: { kind: string }) => space.kind === 'personal').id;
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  const headers = { Origin: 'http://localhost:3100', 'X-CSRF-Token': csrf.csrfToken };
  const create = (path: string, spaceId: string, markdown: string) =>
    page.request.post(`/api/vaults/${vaultId}/notes`, {
      headers,
      data: { path, spaceId, markdown },
    });
  const privateResponse = await create(
    'Journal.md',
    personal,
    '# Journal\n\nPERSONAL-CANARY-never-inline',
  );
  expect(privateResponse.ok()).toBe(true);
  const privateId = (await privateResponse.json()).note.id;
  expect(
    (
      await create(
        'Projects/Detail.md',
        code,
        '# Detail\n\n## Decisions\n\nOnly this section belongs in the embed. ^decision\n\n## Not included\n\nNOT-REQUESTED-SECTION\n\n![[Projects/Overview]]',
      )
    ).ok(),
  ).toBe(true);
  const attachments = [
    {
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4uoAAAAASUVORK5CYII=',
        'base64',
      ),
    },
    { name: 'paper.pdf', mimeType: 'application/pdf', buffer: readingPdf() },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: readingWav() },
    {
      name: 'unsafe.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__readingAttack=1"><script>fetch("https://external.invalid/svg")</script></svg>',
      ),
    },
  ];
  for (const file of attachments)
    expect(
      (
        await page.request.post(
          `/api/vaults/${vaultId}/attachments?path=${encodeURIComponent(`Attachments/${file.name}`)}&spaceId=${code}`,
          { headers, multipart: { file } },
        )
      ).ok(),
    ).toBe(true);
  // Refresh the browser's metadata and in-memory CSRF token after API fixture setup.
  await page.reload();
  await page.getByLabel('Space filter', { exact: true }).selectOption(code);
  await page.getByLabel('New note', { exact: true }).fill('Projects/Overview');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  const source = [
    '---',
    'status: draft',
    '---',
    '# Reading lab',
    '',
    '> [!TIP]- Keep the context',
    '> This collapsed callout keeps its body.',
    '',
    'Inline $E=mc^2$ and display math:',
    '',
    '$$',
    '\\frac{a}{b} = \\sqrt{c}',
    '$$',
    '',
    '```javascript',
    'const message = "<img src=x onerror=alert(1)>";',
    '```',
    '',
    'A footnote[^memory].',
    '',
    '[^memory]: Kept beside the note.',
    '',
    '![[Detail#Decisions]]',
    '',
    '![[Detail#^decision]]',
    '',
    '![[Journal]]',
    '',
    '![External](https://external.invalid/image.png)',
    '',
    '![[Attachments/photo.png|A tiny test image]]',
    '',
    '![[Attachments/paper.pdf]]',
    '',
    '![[Attachments/tone.wav]]',
    '',
    '![[Attachments/unsafe.svg]]',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[Notes] --> B[Memory]',
    '```',
    '',
    '```mermaid',
    'flowchart LR',
    '%%{init: {securityLevel: loose}}%%',
    'A --> B',
    '```',
    '',
    '<img src="https://external.invalid/html" onerror="window.__readingAttack=1">',
    '',
    '$\\href{https://external.invalid/math}{blocked}$',
  ].join('\n');
  await page.getByRole('textbox', { name: 'Markdown', exact: true }).fill(source);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Reading', exact: true }).click();
  const reader = page.getByRole('article', { name: 'Reading preview', exact: true }).first();
  await expect(reader.locator('.katex-display')).toBeVisible();
  await expect(reader.locator('.reading-code .hljs-keyword')).toHaveText('const');
  const callout = reader.locator('.reading-callout');
  await expect(callout).not.toHaveAttribute('open');
  await callout.locator('summary').click();
  await expect(callout).toContainText('This collapsed callout keeps its body.');
  await expect(reader.locator('.reading-note-embed')).toHaveCount(2);
  await expect(reader).toContainText('Only this section belongs in the embed.');
  await expect(reader).not.toContainText('NOT-REQUESTED-SECTION');
  await expect(reader).not.toContainText('PERSONAL-CANARY');
  expect(reads.some((url) => url.includes(`/notes/${privateId}`))).toBe(false);
  const photo = reader.getByRole('figure', {
    name: 'Attachment Attachments/photo.png',
    exact: true,
  });
  await photo.scrollIntoViewIfNeeded();
  await expect(photo.getByRole('img')).toBeVisible();
  await expect
    .poll(() => photo.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1);
  const pdf = reader.getByRole('figure', { name: 'Attachment Attachments/paper.pdf', exact: true });
  await pdf.getByRole('button', { name: 'Preview paper.pdf' }).click();
  await expect(pdf).toContainText('Page 1 of 2');
  await expect(pdf.getByRole('status')).toHaveCount(0);
  expect(
    await pdf.locator('canvas').evaluate((canvas) => {
      const data = (canvas as HTMLCanvasElement)
        .getContext('2d')!
        .getImageData(
          0,
          0,
          (canvas as HTMLCanvasElement).width,
          (canvas as HTMLCanvasElement).height,
        ).data;
      for (let i = 0; i < data.length; i += 4) if (data[i]! < 200 && data[i + 3]! > 0) return true;
      return false;
    }),
  ).toBe(true);
  await pdf.getByRole('button', { name: 'Next page' }).click();
  await expect(pdf).toContainText('Page 2 of 2');
  await expect(pdf.getByRole('status')).toHaveCount(0);
  const audio = reader.getByRole('figure', {
    name: 'Attachment Attachments/tone.wav',
    exact: true,
  });
  await audio.getByRole('button', { name: 'Preview tone.wav' }).click();
  await expect
    .poll(() =>
      audio
        .locator('audio')
        .evaluate(
          (node: HTMLAudioElement) =>
            Number.isFinite(node.duration) && node.duration > 0 && node.paused,
        ),
    )
    .toBe(true);
  const svg = reader.getByRole('figure', {
    name: 'Attachment Attachments/unsafe.svg',
    exact: true,
  });
  await svg.getByRole('button', { name: 'Preview unsafe.svg' }).click();
  await expect(svg).toContainText('no inline preview');
  const diagrams = reader.locator('.reading-diagram');
  await expect(diagrams).toHaveCount(2);
  await diagrams.nth(0).getByRole('button', { name: 'Render diagram' }).click();
  await expect(diagrams.nth(0).getByRole('img')).toBeVisible();
  await expect
    .poll(() =>
      diagrams
        .nth(0)
        .getByRole('img')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await diagrams.nth(1).getByRole('button', { name: 'Render diagram' }).click();
  await expect(diagrams.nth(1).getByRole('alert')).toContainText('disabled');
  await diagrams.nth(0).screenshot({ path: info.outputPath('diagram-light.png') });
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(diagrams.nth(0).getByRole('img')).toBeVisible();
  await diagrams.nth(0).screenshot({ path: info.outputPath('diagram-dark.png') });
  await reader
    .locator('.reading-callout')
    .screenshot({ path: info.outputPath('callout-dark.png') });
  expect(
    await page.evaluate(() => (window as Window & { __readingAttack?: number }).__readingAttack),
  ).toBeUndefined();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const notice = await page.request.get('/app/licenses/THIRD-PARTY-NOTICES.txt');
  expect(notice.ok()).toBe(true);
  expect(await notice.text()).toContain('elkjs@');
});
