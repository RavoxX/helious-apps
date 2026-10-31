import { expect, test } from '@playwright/test';
import { latestLink, verifyAndSignIn } from './email-helpers.js';

test('verification blocks login, expired links recover, and fresh links allow sign-in', async ({
  page,
}, info) => {
  const email = `verify-${info.project.name}-${Date.now()}@example.com`;
  const password = 'a private email testing phrase';
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Email tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible();
  const original = await latestLink(page.request, email);
  await page.goto('/app/?mode=login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('alert')).toHaveText('Please verify your email');
  await expect(page.getByRole('button', { name: 'Resend verification email' })).toBeVisible();
  await page.request.post('/__test/expire-token', {
    data: { token: new URL(original).searchParams.get('token') },
  });
  await page.goto(original);
  await expect(page.getByRole('heading', { name: 'This link has reached its end.' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Request a new verification link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists');
  await page.goto(await latestLink(page.request, email));
  await expect(
    page.getByText('Email verified. You can now sign in.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Create your first vault' })).toBeVisible();
  await page.goto(original);
  await expect(page.getByRole('heading', { name: 'This link has reached its end.' })).toBeVisible();
});
test('password reset has neutral responses, checks strength and invalidates every old session', async ({
  page,
}, info) => {
  const email = `reset-${info.project.name}-${Date.now()}@example.com`;
  const password = 'a private email testing phrase';
  const next = 'a different long testing phrase';
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Reset tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, password);
  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText(
    'If an account exists, we sent you an email',
  );
  const link = await latestLink(page.request, email, 'password-reset');
  await page.goto(link);
  await page.getByLabel('New password', { exact: true }).fill('short');
  await page.getByLabel('Confirm new password').fill('short');
  await expect(page.getByRole('button', { name: 'Set new password' })).toBeDisabled();
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByLabel('Confirm new password').fill(next);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('status').last()).toContainText(
    'Review your existing agent/MCP tokens',
  );
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.goto('/app/?mode=login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('incorrect');
  await page.getByLabel('Password', { exact: true }).fill(next);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Create your first vault' })).toBeVisible();
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  const headers = { Origin: 'http://localhost:3100', 'X-CSRF-Token': csrf.csrfToken };
  const known = await page.request.post('/api/auth/forgot-password', { headers, data: { email } });
  const missing = await page.request.post('/api/auth/forgot-password', {
    headers,
    data: { email: 'no-such-user@example.com' },
  });
  expect(known.status()).toBe(missing.status());
  expect(await known.json()).toEqual(await missing.json());
});
