import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-browser test matrix.
 * Covers major desktop browsers and representative mobile viewports.
 * Docs: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './src/test/e2e',
  testMatch: '**/*.e2e.js',

  /* Run tests in parallel — each worker gets its own browser context */
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'playwright-report/results.xml' }],
  ],

  use: {
    /* Base URL — override with PLAYWRIGHT_BASE_URL in CI */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // ── Desktop browsers ──────────────────────────────────────────────────
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },

    // ── Mobile browsers ───────────────────────────────────────────────────
    {
      name: 'mobile-chrome-android',
      use: { ...devices['Pixel 7'] },          // Android Chrome
    },
    {
      name: 'mobile-safari-ios',
      use: { ...devices['iPhone 14'] },         // iOS Safari
    },
    {
      name: 'mobile-safari-ipad',
      use: { ...devices['iPad Pro 11'] },       // iPadOS Safari
    },
  ],

  /* Start the Vite dev server automatically when running locally */
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
