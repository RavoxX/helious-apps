import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';

test('independent panes, coordinated moves, bookmarks and custom hotkeys persist', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(60000);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': isMobile ? '192.0.2.32' : '192.0.2.31' });
  const email = `workspace-${info.project.name}-${Date.now()}@example.com`;
  const password = 'a private workspace testing phrase';
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Writer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, password);
  await page.getByRole('link', { name: 'Vaults', exact: true }).click();
  await page.getByLabel('New vault name').fill('Workspace');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.getByLabel('Current vault')).toContainText('Workspace');
  async function create(path: string, markdown: string) {
    await page.getByLabel('New note', { exact: true }).fill(path);
    await page.getByRole('button', { name: 'Create note', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(path);
    await page.getByRole('textbox', { name: 'Markdown', exact: true }).fill(markdown);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  }
  await create('A.md', '# Alpha\n\nRead [[B]].');
  await create('Folder/B.md', '# Beta\n\nA second thought.');
  await page.getByRole('button', { name: 'Bookmark Folder/B.md', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Bookmarks' })
      .getByRole('button', { name: 'Folder/B.md', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Split pane', exact: true }).click();
  const panes = page.locator('.notebook-pane:not([hidden])');
  await expect(panes).toHaveCount(2);
  const alpha = panes.filter({ has: page.locator('input[value="A.md"]') });
  const beta = panes.filter({ has: page.locator('input[value="Folder/B.md"]') });
  await alpha
    .getByRole('textbox', { name: 'Markdown', exact: true })
    .fill('# Alpha\n\nRead [[B]].\n\nOnly this pane changes.');
  await alpha.getByRole('textbox', { name: 'Markdown', exact: true }).press('Control+s');
  await expect(alpha.getByText('Note saved', { exact: true })).toBeVisible();
  await expect(beta.getByRole('textbox', { name: 'Markdown', exact: true })).toHaveText(
    '# Beta\n\nA second thought.',
    { useInnerText: true },
  );
  await page.getByRole('button', { name: 'Rename or move Folder/B.md', exact: true }).click();
  await page.getByLabel('New path for Folder/B.md', { exact: true }).fill('Archive/Beta.md');
  await page.locator('.file-move-form').getByRole('button', { name: 'Move', exact: true }).click();
  await expect(
    page.locator('.note-list').getByRole('button', { name: 'Archive/Beta.md', exact: true }),
  ).toBeVisible();
  await expect(alpha.getByRole('textbox', { name: 'Markdown', exact: true })).toContainText(
    '[[/Archive/Beta.md]]',
  );
  if (!isMobile) {
    await page
      .locator('.note-list')
      .getByRole('button', { name: 'A.md', exact: true })
      .dragTo(page.locator('.file-folder > summary').filter({ hasText: 'Archive' }));
    await expect(
      page.locator('.note-list').getByRole('button', { name: 'Archive/A.md', exact: true }),
    ).toBeVisible();
  }
  await page.getByText('Hotkeys', { exact: true }).click();
  await page.getByLabel('Save note shortcut', { exact: true }).fill('Mod+O');
  await page.getByRole('button', { name: 'Save hotkeys', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('different shortcut');
  await page.getByLabel('Save note shortcut', { exact: true }).fill('Mod+Shift+S');
  await page.getByRole('button', { name: 'Save hotkeys', exact: true }).click();
  await expect(page.getByText('Hotkeys saved.', { exact: true })).toBeVisible();
  await page.getByText('Hotkeys', { exact: true }).click();
  const active = page
    .locator('.notebook-pane:not([hidden])')
    .filter({ has: page.locator('input[value="Archive/Beta.md"]') });
  await active
    .getByRole('textbox', { name: 'Markdown', exact: true })
    .fill('# Beta\n\nSaved with my shortcut.');
  await active.getByRole('textbox', { name: 'Markdown', exact: true }).press('Control+Shift+s');
  await expect(active.getByText('Note saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(page.locator('#vault-explorer')).toBeHidden();
  await page.keyboard.press('Control+o');
  await expect(page.getByRole('dialog', { name: 'Quick switcher' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('split-workspace.png'), fullPage: true });
  await page.reload();
  await page.getByRole('link', { name: 'Vaults', exact: true }).click();
  await expect(page.locator('.notebook-pane:not([hidden])')).toHaveCount(2);
  await expect(
    page
      .getByRole('region', { name: 'Bookmarks' })
      .getByRole('button', { name: 'Archive/Beta.md', exact: true }),
  ).toBeVisible();
  await page.getByText('Hotkeys', { exact: true }).click();
  await expect(page.getByLabel('Save note shortcut', { exact: true })).toHaveValue('Mod+Shift+S');
});
