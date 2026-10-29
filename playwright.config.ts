import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'node node_modules/tsx/dist/cli.mjs scripts/preview.ts',
    env: { PORT: '3100', HELIOUS_E2E_EMAIL: '1' },
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
        extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.10' },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.20' },
      },
    },
  ],
});
