import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';
import { fromBase32, totpCode } from '../../apps/server/src/totp.js';
test('authenticator setup, encrypted secrets, reveal expiry, audit and MFA login work', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(90000);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': isMobile ? '192.0.2.112' : '192.0.2.111' });
  const email = `secrets-${info.project.name}-${Date.now()}@example.com`,
    password = 'a private secrets browser passphrase',
    value = 'synthetic-browser-secret-DO-NOT-USE';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app/');
  await page.getByLabel('Your name').fill('Secret keeper');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, password);
  await page.getByLabel('New vault name').fill('Protected project');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await page.getByRole('tab', { name: 'Secrets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A safer place for credentials' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up account protection' }).click();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Scan this QR code with your authenticator app' }),
  ).toBeVisible();
  await page.getByText('Enter a setup key instead', { exact: true }).click();
  const seed = fromBase32(await page.locator('.security-key').innerText());
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totpCode(seed, Math.floor(Date.now() / 30000)));
  await page.getByRole('button', { name: 'Enable authenticator', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save these recovery codes' })).toBeVisible();
  const codes = (await page.locator('.recovery-codes pre').innerText()).split('\n');
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'I saved my recovery codes' }).click();
  await page.getByRole('button', { name: 'Vaults', exact: true }).click();
  await page.getByRole('tab', { name: 'Secrets', exact: true }).click();
  await page.getByRole('button', { name: 'Add secret', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a secret', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Project deploy key');
  await dialog
    .getByRole('combobox', { name: 'Space', exact: true })
    .selectOption({ label: 'Code' });
  await dialog.getByLabel('Secret value', { exact: true }).fill(value);
  await dialog.getByLabel('Confirm with your current password').fill(password);
  await dialog.getByRole('button', { name: 'Save secret', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project deploy key' })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  const revealDialog = page.getByRole('dialog', { name: 'Reveal Project deploy key?' });
  await revealDialog.getByLabel('Current password', { exact: true }).fill(password);
  await revealDialog.getByRole('button', { name: 'Reveal secret', exact: true }).click();
  await expect(page.getByLabel('Revealed secret')).toHaveText(value);
  expect(
    await page.evaluate((needle) => JSON.stringify({ ...localStorage }).includes(needle), value),
  ).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByLabel('Revealed secret')).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('secrets-metadata.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Profile for Secret keeper' }).click();
  await page.getByRole('button', { name: 'Security & access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Secret audit log' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'secret.read', exact: false }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('security-audit.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await page.screenshot({ path: info.outputPath('security-audit-dark.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Profile for Secret keeper' }).click();
  await page
    .getByRole('dialog', { name: 'Account menu' })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Create your account', exact: true }),
  ).toBeVisible();
  await page.goto('/app/?mode=login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByLabel('Authenticator or recovery code', { exact: true })).toBeVisible();
  await page.getByLabel('Authenticator or recovery code', { exact: true }).fill(codes[0]!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Profile for Secret keeper' })).toBeVisible();
  expect(errors).toEqual([]);
});
