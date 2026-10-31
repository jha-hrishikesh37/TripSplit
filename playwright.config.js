import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /e2e\.spec\.js$/,
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  workers: 2,
  maxFailures: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node tests/test-server.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
