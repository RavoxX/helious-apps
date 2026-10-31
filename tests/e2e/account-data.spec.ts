import { expect, test } from '@playwright/test';
import { verifyAndSignIn } from './email-helpers.js';

test('adult declaration, profile correction, private export and account deletion work on the account screen', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.setExtraHTTPHeaders({
    'X-Forwarded-For': info.project.name === 'mobile' ? '192.0.2.72' : '192.0.2.71',
  });
  const email = `data-${info.project.name}-${Date.now()}@example.test`,
    password = 'a private data export testing phrase';
  // Ensure the UI account is not the instance's last admin.
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  await page.request.post('/api/auth/register', {
    headers: { Origin: 'http://localhost:3100', 'X-CSRF-Token': csrf.csrfToken },
    data: { email: `seed-${email}`, password, name: 'Seed administrator' },
  });
  await page.route('**/api/auth/config', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        minimumAge: 18,
        terms: { version: 'browser-fixture', url: '/docs/account-data' },
        privacyUrl: '/docs/account-data',
      },
    });
  });
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Data tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page.getByLabel('I confirm that I am at least 18 years old.')).not.toBeChecked();
  await expect(page.getByRole('heading', { name: 'Make yourself at home.' })).toBeVisible();
  await page.getByLabel('I confirm that I am at least 18 years old.').check();
  await page.getByLabel('I agree to the Terms of Service.').check();
  const sent = page.waitForRequest(
    (r) => r.url().endsWith('/api/auth/register') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create your account' }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    ageConfirmed: true,
    termsAccepted: true,
    termsVersion: 'browser-fixture',
  });
  await verifyAndSignIn(page, email, password);
  await page.getByRole('button', { name: 'Profile for Data tester' }).click();
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await page.getByLabel('Display name').fill('Updated profile');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status')).toContainText('Your name has been updated');
  await page.getByLabel('Current password for export', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Prepare export' }).click();
  await expect(page.getByRole('link', { name: 'Download ZIP' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download ZIP' }).click();
  expect((await download).suggestedFilename()).toMatch(/^helious-export-.*\.zip$/);
  await page.screenshot({ path: info.outputPath('account-data.png'), fullPage: true });
  await page.getByRole('button', { name: 'Delete account…' }).click();
  await expect(page.getByRole('button', { name: 'Permanently delete account' })).toBeDisabled();
  await page.locator('#delete-password').fill(password);
  await page.getByLabel(`Type DELETE ${email} to confirm`).fill(`DELETE ${email}`);
  await page.getByRole('button', { name: 'Permanently delete account' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Your account is closed and permanent erasure is queued.',
  );
});
