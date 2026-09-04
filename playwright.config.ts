import { defineConfig, devices } from '@playwright/test'

/**
 * End to end tests.
 *
 * These run against a DEPLOYED instance rather than spawning a dev server,
 * because the app needs a real Postgres and this project has no local one. Set
 * the target explicitly:
 *
 *   E2E_BASE_URL=http://13.244.x.x npm run test:e2e          # sandbox
 *   E2E_BASE_URL=https://hub.innovalanga.co.za npm run test:e2e
 *
 * The suite assumes the seed data from `prisma/seed.ts` is present, since the
 * assertions name specific seeded accounts.
 *
 * It is deliberately READ ONLY apart from signing in. Nothing here creates,
 * edits or deletes programme records, so it is safe to point at an environment
 * you care about.
 */
export default defineConfig({
  testDir: './e2e',
  // Each role signs in separately and the assertions are independent.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A sandbox behind an Elastic IP has no certificate, so Caddy serves either
    // plain HTTP or a self-signed cert. Neither should fail the run.
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
  },

  // Playwright's own Chromium rather than the system browser, so a CI runner
  // behaves the same as a laptop. Requires `npx playwright install chromium`.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
