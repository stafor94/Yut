import { defineConfig, devices } from '@playwright/test';
import { qaProjectExecutionOptions, qaProjectTestMatches } from './tests/qa/project-contracts.mjs';

const isCi = Boolean(process.env.CI);
const remoteBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? '').trim();
const baseURL = remoteBaseUrl || 'http://127.0.0.1:4173';
const isOnlineCoreQa = String(process.env.QA_ROLE ?? '').trim() === 'online-core';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: isCi ? [['list']] : [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: isCi ? 'off' : 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: remoteBaseUrl ? undefined : {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: qaProjectTestMatches['desktop-chromium'],
      fullyParallel: qaProjectExecutionOptions['desktop-chromium'].fullyParallel || isOnlineCoreQa,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile-galaxy',
      testMatch: qaProjectTestMatches['mobile-galaxy'],
      fullyParallel: qaProjectExecutionOptions['mobile-galaxy'].fullyParallel,
      use: { ...devices['Galaxy S9+'], viewport: { width: 412, height: 915 }, deviceScaleFactor: 3.5 },
    },
    {
      name: 'mobile-webkit-timing',
      testMatch: qaProjectTestMatches['mobile-webkit-timing'],
      fullyParallel: qaProjectExecutionOptions['mobile-webkit-timing'].fullyParallel,
      use: { ...devices['iPhone 13'] },
    },
  ],
});
