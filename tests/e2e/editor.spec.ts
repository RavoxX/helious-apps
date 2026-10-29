import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';

test('CodeMirror, reading views, retained tab drafts and quick switcher work', async ({
  page,
}, info) => {
  const email = `editor-${info.project.name}-${Date.now()}@example.com`;
  const password = 'a private editor testing phrase';
  await page.goto('/app/');
  await page.getByLabel('Your name').fill('Writer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, password);
  await page.getByRole('button', { name: 'Vaults', exact: true }).click();
  await page.getByLabel('New vault name').fill('My notebook');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.getByLabel('Current vault')).toContainText('My notebook');
  async function create(path: string) {
    await page.getByLabel('New note', { exact: true }).fill(path);
    await page.getByRole('button', { name: 'Create note', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note path', exact: true })).toHaveValue(path);
  }
  await create('A.md');
  const source = page.getByRole('textbox', { name: 'Markdown', exact: true });
  await source.fill('# Connected thinking\n\nA draft worth keeping.');
  await create('B.md');
  await source.fill(
    '# Another thought\n\nRead [[A.md|the first idea]].\n\n<script>alert("unsafe")</script>',
  );
  await page.getByRole('tab', { name: 'A.md', exact: true }).click();
  await expect(source).toHaveText('# Connected thinking\n\nA draft worth keeping.', {
    useInnerText: true,
  });
  await source.press('Control+s');
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Pin A.md', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unpin A.md', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('tab', { name: 'B.md', exact: true }).click();
  await page.getByRole('button', { name: 'Reading', exact: true }).click();
  const preview = page.getByRole('article', { name: 'Reading preview' });
  await expect(preview.getByRole('heading', { name: 'Another thought' })).toBeVisible();
  await expect(preview.locator('script')).toHaveCount(0);
  await preview.getByRole('link', { name: 'the first idea' }).click();
  await expect(page.getByRole('tab', { name: 'A.md', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: /Commands/ }).click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Find a note or command' }).fill('B.md');
  await page.getByRole('dialog').getByRole('button', { name: 'B.md Note' }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('button', { name: 'Close B.md', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unsaved changes');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'B.md', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Live preview', exact: true }).click();
  await expect(source).toBeVisible();
  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('workspace.png'), fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Vaults', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'A.md', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'B.md', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
