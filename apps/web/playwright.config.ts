import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    // Run E2E with reduced motion so the games render their deterministic
    // static layouts (no rising bubbles / particles / count-up). Playwright's
    // actionability waits for a *stable* element, which a continuously
    // animating target never is — the animated path is verified manually.
    // (Set via contextOptions: this Playwright build doesn't expose
    // reducedMotion as a direct `use` option, only colorScheme.)
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: [
    {
      command: 'pnpm dev',
      port: 5174,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Boots the api against the shared dev Postgres. Reuses an already-running
      // api in dev for speed; CI always starts fresh and builds first.
      command: 'pnpm --filter api build && pnpm --filter api start',
      cwd: '../../',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
});
