import { expect, type Page, type APIRequestContext } from '@playwright/test';
export async function latestLink(request: APIRequestContext, email: string, kind = 'verification') {
  let text = '';
  await expect
    .poll(async () => {
      const response = await request.get(`/__test/emails?email=${encodeURIComponent(email)}`);
      const data = await response.json();
      text =
        data.messages.findLast((message: { kind: string }) => message.kind === kind)?.text ?? '';
      return text;
    })
    .toContain('token=');
  return /http:\/\/localhost:3100\/(?:verify-email|reset-password)\?token=[\w-]+/.exec(text)![0];
}
export async function verifyAndSignIn(page: Page, email: string, password: string) {
  // Argon2 + database writes may exceed the default assertion timeout on CI.
  await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible({
    timeout: 15000,
  });
  const link = await latestLink(page.request, email);
  await page.goto(link);
  await expect(
    page.getByText('Email verified. You can now sign in.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
}
