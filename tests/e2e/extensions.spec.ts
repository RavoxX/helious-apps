import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';
test.use({ extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.96' }, actionTimeout: 15000 });
test('extensions require consent, preserve drafts and support reading-only appearance', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const email = `extension-${info.project.name}-${Date.now()}@example.com`;
  await page.goto('/app/');
  await page.getByLabel('Your name').fill('Extension tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a synthetic extension passphrase');
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, 'a synthetic extension passphrase');
  await page.getByLabel('New vault name').fill('Extensions');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await page.getByLabel('New note', { exact: true }).fill('Review');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown', exact: true });
  await editor.fill(
    '---\n# Keep my comment\nstatus: draft\n---\n# Review\n\n{{secret:placeholder}}',
  );
  const extensions = page.locator('.note-extensions:visible');
  await extensions.locator('>summary').click();
  await extensions.getByText('Manage extensions', { exact: true }).click();
  await extensions.getByRole('button', { name: 'Use example manifest' }).click();
  await extensions.getByRole('button', { name: 'Review extension permissions' }).click();
  await expect(
    extensions.getByRole('button', { name: 'Install reviewed extension' }),
  ).toBeDisabled();
  await extensions.getByRole('checkbox', { name: /I grant these editor permissions/ }).check();
  await extensions.getByRole('button', { name: 'Install reviewed extension' }).click();
  await extensions
    .getByLabel('Extension command', { exact: true })
    .selectOption('meeting-tools/checklist');
  await extensions.getByRole('button', { name: 'Preview command' }).click();
  await expect(extensions.getByLabel('Proposed Markdown')).toHaveValue(/## Meeting/);
  await expect(editor).not.toContainText('## Meeting');
  await editor.fill('# A newer draft');
  await expect(extensions.getByRole('button', { name: 'Apply proposal to draft' })).toBeDisabled();
  await extensions.getByRole('button', { name: 'Preview command' }).click();
  await extensions.getByRole('button', { name: 'Apply proposal to draft' }).click();
  await expect(editor).toContainText('# A newer draft');
  await expect(editor).toContainText('## Meeting');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await extensions.getByRole('checkbox', { name: 'Meeting tools · 1.0.0' }).uncheck();
  await expect(extensions.getByRole('option', { name: /Append meeting checklist/ })).toHaveCount(0);
  await page.reload();
  await expect(editor).toContainText('## Meeting');
  await page.getByText('Reading appearance', { exact: true }).click();
  const snippet = page.getByLabel('Reading CSS snippet');
  await snippet.fill('body {color:red}');
  await page.getByRole('button', { name: 'Save reading appearance', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Selectors must start' })).toBeVisible();
  await snippet.fill('.markdown-reading h1 { color: #123456; }');
  await page.getByRole('button', { name: 'Save reading appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Reading', exact: true }).click();
  await expect(page.locator('.markdown-reading:visible h1').first()).toHaveCSS(
    'color',
    'rgb(18, 52, 86)',
  );
  await page.getByRole('button', { name: 'Reset reading appearance' }).click();
  await expect(page.locator('.reading-appearance style')).toHaveCount(0);
});
