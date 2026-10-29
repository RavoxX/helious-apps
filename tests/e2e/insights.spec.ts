import { expect, test, type Page } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';

async function account(page: Page, suffix: string) {
  await page.setExtraHTTPHeaders({
    'X-Forwarded-For': suffix === 'mobile' ? '192.0.2.80' : '192.0.2.81',
  });
  const email = `graph-${suffix}-${Date.now()}@example.com`;
  const password = 'a private graph testing passphrase';
  await page.goto('/app/');
  await page.getByLabel('Your name').fill('Graph explorer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, password);
  await page.getByRole('button', { name: 'Vaults', exact: true }).click();
  await page.getByLabel('New vault name').fill('Connected thinking');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.getByLabel('Current vault')).toContainText('Connected thinking');
  const vaultId = await page.getByLabel('Current vault').inputValue();
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const headers = { Origin: 'http://localhost:3100', 'X-CSRF-Token': csrfToken };
  return { vaultId, headers };
}

test('real graph, local depth, filters, forces, themes and vault analytics work', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { vaultId, headers } = await account(page, info.project.name);
  async function note(path: string, markdown: string) {
    const response = await page.request.post(`/api/vaults/${vaultId}/notes`, {
      headers,
      data: { path, markdown },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).note;
  }
  const first = await note(
    'Projects/Architecture.md',
    '# Architecture\n[[Storage]] [[Missing]] #code',
  );
  await note('Projects/Storage.md', '# Storage\n[[Learning/Research.md]] #code');
  await note('Learning/Research.md', '# Research\n#research');
  await note('Journal.md', '# Journal\nA thought of my own.');
  // Existing creation dates are immutable; the server fixture is shifted only in this intercepted graph response to exercise replay.
  await page.route(`**/api/vaults/${vaultId}/graph?includeFiles=true`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.nodes.forEach((node: { createdAt: string }, i: number) => {
      node.createdAt = `2026-10-${String(20 + i).padStart(2, '0')}T12:00:00.000Z`;
    });
    await route.fulfill({ response, json: data });
  });
  await page.getByRole('tab', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.knowledge-canvas')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('status').filter({ hasText: '4 nodes' })).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in knowledge graph', exact: true }).click();
  await expect
    .poll(() => page.locator('.knowledge-canvas').getAttribute('data-zoom'))
    .not.toBe('1.000');
  await page.getByRole('button', { name: 'Reset knowledge graph camera', exact: true }).click();
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await page.getByLabel('Existing files only', { exact: true }).uncheck();
  await expect(page.getByRole('status').filter({ hasText: '5 nodes' })).toBeVisible();
  await page.getByLabel('Graph filter', { exact: true }).fill('tag:code');
  await expect(page.getByRole('status').filter({ hasText: '2 nodes' })).toBeVisible();
  await page.getByLabel('Graph filter', { exact: true }).fill('');
  await page.getByLabel('Existing files only', { exact: true }).check();
  await page.getByRole('button', { name: 'Local graph', exact: true }).click();
  await page.getByLabel('Local graph center', { exact: true }).selectOption(first.id);
  await expect(page.getByRole('status').filter({ hasText: '2 nodes' })).toBeVisible();
  await page.getByLabel('Local graph depth', { exact: true }).fill('2');
  await expect(page.getByRole('status').filter({ hasText: '3 nodes' })).toBeVisible();
  await page.getByText('Groups', { exact: true }).click();
  await page.getByLabel('Group query', { exact: true }).fill('tag:code');
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove group tag:code' })).toBeVisible();
  await page.getByText('Forces', { exact: true }).click();
  await page.getByLabel('Repel force', { exact: true }).fill('300');
  await page.getByLabel('Link distance', { exact: true }).fill('80');
  await page.getByText('Display', { exact: true }).click();
  await page.getByLabel('Direction arrows', { exact: true }).check();
  await page.getByRole('button', { name: 'Global graph', exact: true }).click();
  await page.getByRole('button', { name: 'Pause graph layout', exact: true }).click();
  await expect(page.getByText('Layout paused', { exact: true })).toBeVisible();
  await page.getByLabel('Graph timeline', { exact: true }).fill('0');
  await expect(page.getByRole('status').filter({ hasText: '1 nodes' })).toBeVisible();
  await page.getByRole('button', { name: 'Play graph timeline', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '4 nodes' })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await page.screenshot({ path: info.outputPath('graph-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await page.screenshot({ path: info.outputPath('graph-dark.png'), fullPage: true });
  await page.getByText('Note navigator · keyboard and list view', { exact: true }).click();
  if (!isMobile) {
    await page
      .getByRole('button', { name: 'Focus Projects/Architecture.md in graph', exact: true })
      .click();
    const stage = page.locator('.knowledge-canvas');
    await stage.scrollIntoViewIfNeeded();
    await expect.poll(() => stage.getAttribute('data-zoom')).toBe('0.200');
    const box = (await stage.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 45, y + 25, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole('tab', { name: 'Graph', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.mouse.click(x + 45, y + 25);
  } else
    await page
      .getByRole('button', { name: 'Open Projects/Architecture.md from navigator', exact: true })
      .click();
  await expect(page.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(
    'Projects/Architecture.md',
  );
  await page.getByRole('button', { name: 'View local graph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Local graph', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await page.getByText('Groups', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove group tag:code' })).toBeVisible();
  await page.getByText('Forces', { exact: true }).click();
  await expect(page.getByLabel('Repel force', { exact: true })).toHaveValue('300');
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Vault analytics' })).toContainText('4');
  await expect(page.getByRole('img', { name: /recorded note changes/ })).toBeVisible();
  await expect(
    page.getByText('No agent activity in this view yet.', { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('vault-analytics.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  if (isMobile) await expect(page.locator('.graph-stage')).toHaveCount(0);
});

test('12,000-node WebGL graph keeps camera and layout controls responsive', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(60000);
  if (isMobile) await page.emulateMedia({ reducedMotion: 'reduce' });
  const { vaultId } = await account(page, `large-${info.project.name}`);
  const nodes = Array.from({ length: 12000 }, (_unused, i) => ({
    id: i.toString(16).padStart(24, '0'),
    path: `Projects/Note ${i}.md`,
    title: `Note ${i}`,
    tags: ['code'],
    incoming: i ? 1 : 0,
    outgoing: 1,
    kind: 'note',
    createdAt: '2026-10-20T12:00:00.000Z',
    wordCount: 10,
  }));
  const edges = Array.from({ length: 11999 }, (_unused, i) => ({
    source: nodes[i + 1]!.id,
    target: nodes[Math.floor(i / 3)]!.id,
    count: 1,
  }));
  await page.route(`**/api/vaults/${vaultId}/graph?includeFiles=true`, (route) =>
    route.fulfill({ json: { nodes, edges, unresolved: [] } }),
  );
  await page.getByRole('tab', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.knowledge-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 20000,
  });
  await expect(page.getByRole('status').filter({ hasText: '12,000 nodes' })).toBeVisible();
  await expect(page.getByText('Layout settled', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Pause graph layout', exact: true }).click();
  await expect(page.getByText('Layout paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in knowledge graph', exact: true }).click();
  await expect
    .poll(() => page.locator('.knowledge-canvas').getAttribute('data-zoom'))
    .not.toBe('1.000');
  await page.getByRole('button', { name: 'Reset knowledge graph camera', exact: true }).click();
  await expect
    .poll(() => page.locator('.knowledge-canvas').getAttribute('data-zoom'))
    .toBe('1.000');
  await page.screenshot({ path: info.outputPath('graph-12000-node-fixture.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (!isMobile) {
    const graph = page.locator('.knowledge-canvas');
    const box = (await graph.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
  }
});

test('graph has a usable note navigator when WebGL is unavailable', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (this: HTMLCanvasElement, type: string, ...options: unknown[]) {
        return type === 'webgl' || type === 'webgl2'
          ? null
          : Reflect.apply(original, this, [type, ...options]);
      },
    });
  });
  const { vaultId, headers } = await account(page, `fallback-${info.project.name}`);
  const response = await page.request.post(`/api/vaults/${vaultId}/notes`, {
    headers,
    data: { path: 'Fallback.md', markdown: '# Still accessible' },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole('tab', { name: 'Graph', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('WebGL could not start');
  await page.getByText('Note navigator · keyboard and list view', { exact: true }).click();
  await page.getByRole('button', { name: 'Open Fallback.md from navigator', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(
    'Fallback.md',
  );
  await expect(page.getByRole('tab', { name: 'Fallback.md', exact: true })).toBeVisible();
});
