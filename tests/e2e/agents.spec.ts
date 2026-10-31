import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { verifyAndSignIn } from './email-helpers.js';
test('agent settings, project memory, real MCP calls, OAuth consent and revocation work', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(90000);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': isMobile ? '192.0.2.122' : '192.0.2.121' });
  const email = `agent-${info.project.name}-${Date.now()}@example.com`,
    password = 'a private agent browser passphrase',
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Connected developer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await verifyAndSignIn(page, email, password);
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: 'AI connections', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'AI connections' })).toBeVisible();
  await page.getByRole('button', { name: 'Create agent token', exact: true }).click();
  await page.getByLabel('Connection name', { exact: true }).fill('Codex test connection');
  const createToken = page.getByRole('button', { name: 'Create token with these permissions' });
  await expect(createToken).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: 'Create a vault to connect your agent' }),
  ).toBeVisible();
  await page.getByLabel('New vault name', { exact: true }).fill('Connected project');
  await page.getByRole('button', { name: 'Create vault and continue' }).click();
  await expect(page.getByRole('checkbox', { name: /^Code/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Code/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^Personal/ })).toBeDisabled();
  await expect(createToken).toBeDisabled();
  await expect(page.getByLabel('Connection name', { exact: true })).toHaveValue(
    'Codex test connection',
  );
  await page.getByRole('checkbox', { name: /^Code/ }).check();
  await page
    .getByRole('checkbox', { name: 'Create and update notes, with version history', exact: true })
    .check();
  await page.getByLabel('Confirm with your current password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create token with these permissions' }).click();
  await expect(page.getByRole('heading', { name: 'Save this token now' })).toBeVisible();
  const token = await page.locator('.one-time-token code').innerText();
  expect(token).toMatch(/^hel_pat_/);
  expect(
    await page.evaluate((value) => JSON.stringify({ ...localStorage }).includes(value), token),
  ).toBe(false);
  await page.getByRole('button', { name: 'I saved my token' }).click();
  await expect(page.locator('.one-time-token')).not.toBeVisible();
  const options = await (await page.request.get('/api/agents/options')).json();
  const vaultId = options.vaults[0].id,
    spaceId = options.spaces.find((space: { name: string }) => space.name === 'Code').id;
  const rpc = async (name: string, args: unknown) =>
    page.request.post('/mcp', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
  const created = await rpc('create_note', {
    vaultId,
    spaceId,
    path: 'Architecture.md',
    markdown: '# Architecture\n\nWe keep workers independent.',
  });
  expect(created.status()).toBe(200);
  expect((await created.json()).result.isError).not.toBe(true);
  await page.getByRole('combobox', { name: 'Vault', exact: true }).selectOption(vaultId);
  await page.getByLabel('Project name', { exact: true }).fill('demo');
  await page.getByRole('button', { name: 'Create project memory', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Project memory created' }),
  ).toBeVisible();
  const remembered = await rpc('remember', {
    vaultId,
    spaceId,
    project: 'demo',
    entry: 'A shared project memory from the browser test.',
  });
  expect((await remembered.json()).result.isError).not.toBe(true);
  await page.screenshot({ path: info.outputPath('agent-connections.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const client = await (
    await page.request.post('/oauth/register', {
      data: {
        client_name: 'Browser OAuth test',
        redirect_uris: ['http://127.0.0.1:4567/callback'],
        token_endpoint_auth_method: 'none',
      },
    })
  ).json();
  const verifier = 'x'.repeat(64),
    params = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:4567/callback',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      scope: 'notes:read',
      state: 'browser-state',
      resource: 'http://localhost:3100/mcp',
    });
  await page.goto('/oauth/authorize?' + params);
  await expect(page.getByRole('heading', { name: 'Connect Browser OAuth test' })).toBeVisible();
  await expect(page.getByText('http://127.0.0.1:4567', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /^Code/ }).check();
  await page.screenshot({ path: info.outputPath('oauth-consent.png'), fullPage: true });
  await page.route('http://127.0.0.1:4567/callback?**', (route) =>
    route.fulfill({ contentType: 'text/plain', body: 'OAuth callback received' }),
  );
  await page.getByRole('button', { name: 'Allow selected access', exact: true }).click();
  await expect(page).toHaveURL(/callback\?.*code=/);
  const code = new URL(page.url()).searchParams.get('code')!;
  expect(new URL(page.url()).searchParams.get('state')).toBe('browser-state');
  const exchange = await page.request.post('http://localhost:3100/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:4567/callback',
      resource: 'http://localhost:3100/mcp',
    },
  });
  expect(exchange.status()).toBe(200);
  await page.goto('http://localhost:3100/app/');
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: 'AI connections', exact: true })
    .click();
  const connection = page
    .locator('.connection-row')
    .filter({ has: page.getByRole('heading', { name: 'Codex test connection', exact: true }) });
  await connection.getByRole('button', { name: 'Revoke', exact: true }).click();
  await connection.getByRole('button', { name: 'Confirm revoke', exact: true }).click();
  await expect(connection).toContainText('Revoked');
  expect((await rpc('list_vaults', {})).status()).toBe(401);
  expect(errors).toEqual([]);
});
