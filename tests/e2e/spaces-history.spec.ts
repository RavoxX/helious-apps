import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';

test('spaces, explicit Personal policies, revision diffs and deleted-note recovery work', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(90000);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': isMobile ? '192.0.2.102' : '192.0.2.101' });
  const email = `spaces-${info.project.name}-${Date.now()}@example.com`;
  const password = 'a private spaces testing passphrase';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app/');
  await page.getByLabel('Your name').fill('Connected writer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, password);
  await page.getByLabel('New vault name').fill('My knowledge');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.getByLabel('Space filter')).toContainText('Personal');
  await expect(page.getByLabel('Space filter')).toContainText('Code');
  await page.getByLabel('New note', { exact: true }).fill('Decision.md');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  const path = page.getByRole('textbox', { name: 'Note path', exact: true });
  await expect(path).toHaveValue('Decision.md');
  await expect(page.getByLabel('Note space', { exact: true }).locator('option:checked')).toHaveText(
    'Personal',
  );
  const editor = page.getByRole('textbox', { name: 'Markdown', exact: true });
  await editor.fill('# Decision\n\nThe first direction.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await editor.fill('# Decision\n\nThe second direction.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  const history = page.getByRole('region', { name: 'Note version history', exact: true });
  await history.getByLabel('Revision to review').selectOption('2');
  await expect(history.getByLabel('Revision differences')).toContainText('The first direction.');
  await expect(history.locator('.diff-added')).toContainText('The second direction.');
  await expect(history.locator('.diff-removed')).toContainText('The first direction.');
  await editor.fill('An unsaved draft');
  await expect(history.getByRole('button', { name: 'Restore this revision' })).toBeDisabled();
  await page.getByRole('button', { name: 'Discard edits and reload', exact: true }).click();
  await expect(editor).toHaveText('# Decision\n\nThe second direction.', { useInnerText: true });
  await page.getByLabel('Note space', { exact: true }).selectOption({ label: 'Code' });
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await history.getByLabel('Revision to review').selectOption('2');
  await history.getByRole('button', { name: 'Restore this revision' }).click();
  await expect(history.locator('.history-restore-confirm')).toContainText('Personal');
  await history.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(history.getByRole('status')).toContainText('Restored as revision 5.');
  await expect(editor).toHaveText('# Decision\n\nThe first direction.', { useInnerText: true });
  await page.screenshot({ path: info.outputPath('version-history.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close version history' }).click();
  await page.getByText('Spaces & permissions', { exact: true }).click();
  const manager = page.locator('.spaces-manager');
  await manager.getByLabel('Agent access for Personal').selectOption('read');
  await expect(manager.getByRole('button', { name: 'Save Personal policy' })).toBeDisabled();
  await manager
    .getByRole('checkbox', {
      name: 'I want to make Personal eligible for explicitly scoped agent tokens.',
    })
    .check();
  await manager.getByRole('button', { name: 'Save Personal policy' }).click();
  await expect(manager.locator('.space-policy-row').first().getByRole('status')).toHaveText(
    'Policy saved.',
  );
  await manager.getByLabel('Agent access for Personal').selectOption('none');
  await manager.getByRole('button', { name: 'Save Personal policy' }).click();
  await expect(manager.locator('.space-policy-row').first().getByRole('status')).toHaveText(
    'Policy saved.',
  );
  await manager.getByLabel('New space name').fill('Research');
  await manager.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(page.getByLabel('Space filter')).toContainText('Research');
  await expect(manager.getByLabel('Agent access for Research')).toHaveValue('none');
  await manager.getByLabel('Agent access for Code').selectOption('read');
  await manager.getByRole('button', { name: 'Save Code policy' }).click();
  await expect(manager.locator('.space-policy-row').nth(1).getByRole('status')).toHaveText(
    'Policy saved.',
  );
  await page.screenshot({ path: info.outputPath('spaces-permissions.png'), fullPage: true });
  await page.getByText('Spaces & permissions', { exact: true }).click();
  await page.getByLabel('Note space', { exact: true }).selectOption({ label: 'Research' });
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page.getByLabel('Space filter').selectOption({ label: 'Code' });
  await expect(page.locator('.note-list .note-file')).toHaveCount(0);
  await page.getByLabel('Space filter').selectOption({ label: 'Research' });
  await expect(page.locator('.note-list .note-file')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete this note', exact: true }).click();
  await expect(page.locator('.note-list .note-file')).toHaveCount(0);
  await page.getByText('Deleted notes', { exact: true }).click();
  await page
    .locator('.deleted-notes > ul')
    .getByRole('button', { name: /Decision.md/ })
    .click();
  const recovery = page
    .locator('.deleted-notes')
    .getByRole('region', { name: 'Note version history' });
  await recovery.getByLabel('Revision to review').selectOption('2');
  await recovery.getByRole('button', { name: 'Restore this revision' }).click();
  await recovery.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(path).toHaveValue('Decision.md');
  await expect(editor).toHaveText('# Decision\n\nThe first direction.', { useInnerText: true });
  await page.getByLabel('Space filter').selectOption({ label: 'Personal' });
  await page.getByRole('tab', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.knowledge-canvas')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('status').filter({ hasText: '1 nodes' })).toBeVisible();
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A view of your thinking.' })).toBeVisible();
  await page.getByLabel('Space filter').selectOption({ label: 'Code' });
  await expect(page.locator('.vault-metrics dd').first()).toHaveText('0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
