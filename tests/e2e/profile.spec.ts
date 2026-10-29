import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';

test('profile shortcuts and first-vault guidance work with keyboard, themes and mobile', async ({
  page,
  isMobile,
}, info) => {
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': isMobile ? '192.0.2.92' : '192.0.2.91' });
  const email = `profile-${info.project.name}-${Date.now()}@example.com`;
  const password = 'a private profile testing passphrase';
  await page.goto('/app/');
  await page.getByLabel('Your name').fill('Alex Writer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, password);
  await expect(page.getByRole('heading', { name: 'Create your first vault' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Getting started with your vault' })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Profile for Alex Writer', exact: true });
  const menu = page.getByRole('dialog', { name: 'Account menu' });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByText(email, { exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Account settings', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('heading', { name: 'Create your first vault' }).click();
  await expect(menu).not.toBeVisible();
  await trigger.click();
  await menu.getByRole('button', { name: 'Account settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeFocused();
  await expect(page.getByRole('definition').filter({ hasText: email })).toBeVisible();
  await expect(menu).not.toBeVisible();
  const wasDark = (await page.locator('html').getAttribute('data-theme')) === 'dark';
  await page
    .getByRole('button', { name: wasDark ? 'Use light theme' : 'Use dark theme', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', wasDark ? 'light' : 'dark');
  await expect(
    page.getByRole('button', { name: wasDark ? 'Switch to dark mode' : 'Switch to light mode' }),
  ).toBeVisible();
  await trigger.click();
  await expect(
    menu.getByRole('button', { name: wasDark ? 'Use dark theme' : 'Use light theme', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('profile-menu.png'), fullPage: true });
  await menu.getByRole('button', { name: 'Active sessions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your active sessions' })).toBeFocused();
  await page.getByRole('button', { name: 'Vaults', exact: true }).click();
  await page.getByLabel('New vault name').fill('My knowledge');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.getByLabel('Current vault')).toContainText('My knowledge');
  await expect(page.getByRole('tablist', { name: 'Vault views' })).toHaveCSS('display', 'flex');
  await expect(page.getByLabel('New vault name')).not.toBeVisible();
  await page.getByRole('button', { name: 'Create your first note', exact: true }).click();
  await expect(page.getByLabel('New note', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'New vault', exact: true }).click();
  await expect(page.getByLabel('New vault name')).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('New vault name')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await trigger.click();
  await menu.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Create your account', exact: true }),
  ).toBeVisible();
});
