import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';

test('vaults, Markdown edits, search, backlinks and attachments survive reload', async ({
  page,
}, info) => {
  const email = `notes-${info.project.name}-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Knowledge tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a private knowledge passphrase');
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, 'a private knowledge passphrase');
  await page.getByRole('link', { name: 'Vaults', exact: true }).click();
  await page.getByLabel('New vault name').fill('My projects');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.getByLabel('Current vault')).toContainText('My projects');
  await page.getByLabel('New note', { exact: true }).fill('Decisions');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(
    'Decisions.md',
  );
  await page
    .getByRole('textbox', { name: 'Markdown', exact: true })
    .fill('# Architecture\n\nUse plain Markdown. #code');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page.getByLabel('New note', { exact: true }).fill('Overview');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(
    'Overview.md',
  );
  await page
    .getByRole('textbox', { name: 'Markdown', exact: true })
    .fill('# Project overview\n\nRead [[Decisions#Architecture]]. #project');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Decisions#Architecture' }).click();
  await expect(page.getByRole('button', { name: 'Overview.md', exact: true }).last()).toBeVisible();
  await page.getByLabel('Search notes', { exact: true }).fill('tag:project');
  await page.getByRole('button', { name: 'Search vault', exact: true }).click();
  await expect(page.locator('.note-list .note-file')).toHaveCount(1);
  await expect(page.locator('.note-list')).toContainText('Overview.md');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'diagram.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('a useful attachment'),
  });
  await expect(page.getByRole('link', { name: 'diagram.txt', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: 'Vaults', exact: true }).click();
  await expect(page.locator('.note-list .note-file')).toHaveCount(2);
  await page
    .locator('.note-list')
    .getByRole('button', { name: 'Decisions.md', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toHaveText(
    '# Architecture\n\nUse plain Markdown. #code',
    { useInnerText: true },
  );
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  const noteResponse = await page.request.get('/api/vaults');
  const vaultId = (await noteResponse.json()).vaults[0].id;
  const list = await (await page.request.get(`/api/vaults/${vaultId}/notes`)).json();
  const note = list.notes.find((item: { path: string }) => item.path === 'Decisions.md');
  const updated = await page.request.patch(`/api/vaults/${vaultId}/notes/${note.id}`, {
    headers: { Origin: 'http://localhost:3100', 'X-CSRF-Token': csrf.csrfToken },
    data: { revision: note.revision, markdown: 'Changed by another browser' },
  });
  expect(updated.ok()).toBe(true);
  await page.getByRole('textbox', { name: 'Markdown', exact: true }).fill('My unsaved edit');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed elsewhere');
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toHaveText(
    'My unsaved edit',
  );
  await page.getByRole('button', { name: 'Discard edits and reload' }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toHaveText(
    'Changed by another browser',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('Vault settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete vault', exact: true }).click();
  await page.getByRole('button', { name: 'Delete vault and its content', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create your first vault' })).toBeVisible();
});
