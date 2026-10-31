import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';

test('vault bookmarks, history and signed-out return paths preserve the chosen vault', async ({
  page,
  isMobile,
}, info) => {
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': isMobile ? '192.0.2.182' : '192.0.2.181' });
  const email = `navigation-${info.project.name}-${Date.now()}@example.com`;
  const password = 'a private navigation testing passphrase';
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Navigation tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, password);
  await expect(page.getByRole('heading', { name: 'Create your first vault' })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const create = async (name: string) => {
    const response = await page.request.post('/api/vaults', {
      headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
      data: { name },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).vault.id as string;
  };
  const first = await create('First vault');
  const second = await create('Second vault');
  const secondPath = `/app/vaults/${second}`;
  // A fresh document must use the URL's second vault, not the first API result.
  await page.goto(secondPath);
  await expect(page.getByLabel('Current vault')).toHaveValue(second);
  await expect(page).toHaveURL(origin + secondPath);
  await page.reload();
  await expect(page.getByLabel('Current vault')).toHaveValue(second);
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await expect(page).toHaveTitle('Home · Helious');
  await page
    .getByRole('region', { name: 'Your vaults' })
    .getByRole('button', { name: 'First vault', exact: true })
    .click();
  await expect(page.getByLabel('Current vault')).toHaveValue(first);
  await page.goBack();
  await expect(page).toHaveURL(origin + '/app/home');
  await page.goForward();
  await expect(page.getByLabel('Current vault')).toHaveValue(first);
  await page.goBack();
  await expect(page).toHaveURL(origin + '/app/home');
  await page.goBack();
  await expect(page.getByLabel('Current vault')).toHaveValue(second);
  await expect(page).toHaveURL(origin + secondPath);
  await page.getByRole('button', { name: 'Profile for Navigation tester', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Account menu' })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click();
  await expect(page).toHaveURL(origin + '/login');
  await page.goto(secondPath);
  await expect(page).toHaveURL(origin + `/login?next=${encodeURIComponent(secondPath)}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByLabel('Current vault')).toHaveValue(second);
  await expect(page).toHaveURL(origin + secondPath);
  await page.goto('/login?next=https%3A%2F%2Funtrusted.example%2F');
  await expect(page).toHaveURL(/\/app\/vaults(?:\/[\w-]+)?$/);
  expect(new URL(page.url()).origin).toBe(origin);
});
