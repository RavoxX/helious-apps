import { expect, test } from '@playwright/test';

test('built documentation supports search, shortcuts, navigation and persisted appearance under CSP', async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy/i.test(message.text()))
      errors.push(message.text());
  });
  const response = await page.goto('/docs/getting-started');
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(response?.headers()['content-security-policy']).not.toMatch(
    /script-src[^;]*unsafe-inline/,
  );
  await expect(page.getByRole('heading', { name: /^Get started/ })).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const search = page.locator('#localsearch-input');
  await expect(search).toBeVisible();
  await search.fill('verification');
  await expect(page.locator('#localsearch-list a.result').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).not.toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');

  if (isMobile) await page.locator('.VPLocalNav .menu').click();
  await page.locator('.VPSidebar a[href="/docs/editor"]').click();
  await expect(page).toHaveURL(/\/docs\/editor$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^The Markdown workspace/ })).toBeVisible();
  if (isMobile) await page.locator('.VPNavBarHamburger').click();
  const appearance = page.locator('.VPSwitchAppearance:visible');
  const wasDark = await page.locator('html').evaluate((html) => html.classList.contains('dark'));
  await appearance.click();
  await expect(page.locator('html')).toHaveClass(wasDark ? /^(?!.*\bdark\b)/ : /\bdark\b/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(wasDark ? /^(?!.*\bdark\b)/ : /\bdark\b/);
  expect(errors).toEqual([]);
});
