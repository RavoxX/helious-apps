import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';
// Keep this request-heavy scenario out of the shared legacy-client rate budget.
// The fixture trusts loopback only; production rate limits remain unchanged.
test.use({ actionTimeout: 15000, extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.92' } });

test('templates, daily notes, typed properties and conflict-safe canvases', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const email = `authoring-${info.project.name}-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Authoring tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a private authoring passphrase');
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, 'a private authoring passphrase');
  await page.getByRole('link', { name: 'Vaults', exact: true }).click();
  await page.getByLabel('New vault name').fill('Authoring');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await page.getByText('Daily notes & templates', { exact: true }).click();
  await page.getByLabel('New template name').fill('Meeting');
  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown', exact: true });
  await expect(page.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(
    'Templates/Meeting.md',
  );
  await editor.fill(
    '---\n# Keep this comment\nstatus: draft # workflow\n---\n# {{title}}\n\n{{date}} {{secret:placeholder}}',
  );
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page
    .getByLabel('Template', { exact: true })
    .selectOption({ label: 'Templates/Meeting.md · Personal' });
  await page.getByLabel('New note from template').fill('Projects/Review');
  await page.getByRole('button', { name: 'Create from template' }).click();
  await expect(page.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(
    'Projects/Review.md',
  );
  await expect(editor).toContainText('# Review');
  await expect(editor).toContainText('{{secret:placeholder}}');
  await page.locator('.properties-editor:visible summary').click();
  await page
    .locator('.properties-editor:visible')
    .getByLabel('Property name', { exact: true })
    .fill('approved');
  await page
    .locator('.properties-editor:visible')
    .getByLabel('Property type', { exact: true })
    .selectOption('boolean');
  await page
    .locator('.properties-editor:visible')
    .getByLabel('Property value', { exact: true })
    .selectOption('true');
  await page.getByRole('button', { name: 'Apply property' }).click();
  await expect(editor).toContainText('# Keep this comment');
  await expect(editor).toContainText('approved: true');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page.getByLabel('Daily note date').fill('2026-02-03');
  await page.getByRole('button', { name: 'Open daily note', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(
    'Daily/2026-02-03.md',
  );
  await expect(editor).toContainText('2026-02-03');
  await editor.fill('# My daily note\n\nKeep my existing text.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Open daily note', exact: true }).click();
  await expect(editor).toContainText('Keep my existing text.');
  await page.getByLabel('Space filter', { exact: true }).selectOption({ label: 'Code' });
  await page.getByText('Daily notes & templates', { exact: true }).click();
  await page.getByLabel('Daily note date').fill('2026-02-03');
  await page.getByRole('button', { name: 'Open daily note', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'another Space' })).toBeVisible();
  await page.getByLabel('Space filter', { exact: true }).selectOption('');
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await page.getByLabel('New canvas path').fill('Canvas/Plan');
  await page.getByRole('button', { name: 'Create canvas', exact: true }).click();
  await expect(page.getByLabel('Open canvas', { exact: true })).toHaveValue('Canvas/Plan.canvas');
  await page.getByLabel('New card content').fill('First idea');
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await page.getByLabel('Card content', { exact: true }).fill('The useful idea');
  await page.getByLabel('Card width').fill('320');
  await page.getByRole('button', { name: 'Apply card changes' }).click();
  await page.getByLabel('New card content').fill('Second idea');
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await page.locator('.canvas-edge-editor summary').click();
  await page
    .getByRole('combobox', { name: 'From card', exact: true })
    .selectOption({ label: 'The useful idea' });
  await page
    .getByRole('combobox', { name: 'To card', exact: true })
    .selectOption({ label: 'Second idea' });
  await page.getByRole('button', { name: 'Connect cards' }).click();
  await page.getByLabel('Connection label').fill('informs');
  await page.getByRole('button', { name: 'Fit cards' }).click();
  await page
    .getByRole('button', { name: 'Select text card Second idea', exact: true })
    .press('ArrowRight');
  await page.getByRole('button', { name: 'Save canvas', exact: true }).click();
  await expect(page.locator('.canvas-toolbar')).toContainText('Saved · revision 2');
  // A second save proves attachment-ID rotation does not lose selection or the CAS fingerprint.
  await page.getByLabel('Card content', { exact: true }).fill('Second idea revised');
  await page.getByRole('button', { name: 'Apply card changes' }).click();
  let release: (() => void) | undefined;
  let applied: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const serverApplied = new Promise<void>((resolve) => {
    applied = resolve;
  });
  const saveRoute = '**/api/vaults/*/sync/file';
  await page.route(saveRoute, async (route) => {
    const response = await route.fetch();
    applied!();
    await gate;
    await route.fulfill({ response });
  });
  const completed = page.waitForResponse(
    (response) => response.url().endsWith('/sync/file') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save canvas', exact: true }).click();
  await serverApplied;
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  release!();
  await completed;
  await page.unroute(saveRoute);
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await page.getByLabel('Open canvas', { exact: true }).selectOption('Canvas/Plan.canvas');
  await expect(page.locator('.canvas-toolbar')).toContainText('Saved · revision 3');
  await page
    .getByRole('button', { name: 'Select text card Second idea revised', exact: true })
    .click();
  await page.getByLabel('Card content', { exact: true }).fill('My unsaved board edit');
  await page.getByRole('button', { name: 'Apply card changes' }).click();
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await page.getByLabel('Open canvas', { exact: true }).selectOption('Canvas/Plan.canvas');
  await expect(
    page.getByRole('button', { name: 'Select text card My unsaved board edit', exact: true }),
  ).toBeVisible();
  const vaults = await (await page.request.get('/api/vaults')).json();
  const vaultId = vaults.vaults[0].id;
  const files = await (await page.request.get(`/api/vaults/${vaultId}/attachments`)).json();
  const file = files.attachments.find(
    (item: { path: string }) => item.path === 'Canvas/Plan.canvas',
  );
  const current = await (
    await page.request.get(`/api/vaults/${vaultId}/sync/file?id=${file.id}&kind=attachment`)
  ).json();
  const remote = JSON.parse(Buffer.from(current.data, 'base64').toString('utf8'));
  expect(remote.edges[0].label).toBe('informs');
  expect(remote.nodes[0].width).toBe(320);
  remote.nodes[0].text = 'Changed by another client';
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  const response = await page.request.post(`/api/vaults/${vaultId}/sync/file`, {
    headers: { Origin: 'http://localhost:3100', 'X-CSRF-Token': csrf.csrfToken },
    data: {
      path: current.file.path,
      spaceId: current.file.spaceId,
      kind: 'attachment',
      expected: current.file,
      data: Buffer.from(JSON.stringify(remote)).toString('base64'),
    },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole('button', { name: 'Save canvas', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your draft is kept');
  await expect(
    page.getByRole('button', { name: 'Select text card My unsaved board edit', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reload canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Discard canvas draft and reload', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Select text card Changed by another client', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.canvas-toolbar')).toContainText('Saved · revision 4');
  await page.getByRole('combobox', { name: 'Card type', exact: true }).selectOption('file');
  await page
    .getByRole('combobox', { name: 'New card content', exact: true })
    .selectOption('Projects/Review.md');
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open note', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Card type', exact: true }).selectOption('link');
  await page.getByLabel('New card content').fill('https://example.com/research');
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open website' })).toHaveAttribute(
    'href',
    'https://example.com/research',
  );
  await page.getByRole('combobox', { name: 'Card type', exact: true }).selectOption('group');
  await page.getByLabel('New card content').fill('Research');
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(page.locator('.canvas-card')).toHaveCount(5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.canvas-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.canvas-card')).toHaveCount(5);
  await page.getByRole('button', { name: 'Fit cards' }).click();
  await page.getByRole('button', { name: 'Save canvas', exact: true }).click();
  await expect(page.locator('.canvas-toolbar')).toContainText('Saved · revision 5');
  expect(
    await page.locator('.canvas-card:not(.canvas-group)').evaluateAll((cards) => {
      const boxes = cards.map((card) => card.getBoundingClientRect());
      return boxes.every((a, index) =>
        boxes
          .slice(index + 1)
          .every(
            (b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
          ),
      );
    }),
  ).toBe(true);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download canvas', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('Plan.canvas');
  await page.locator('.canvas-viewport').screenshot({ path: info.outputPath('canvas-light.png') });
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await page.locator('.canvas-viewport').screenshot({ path: info.outputPath('canvas-dark.png') });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
