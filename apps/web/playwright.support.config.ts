import { defineConfig, devices } from '@playwright/test'
import { SUPPORT_ENV_FILE, supportEnv } from './e2e/support/env'
import { ensureSinkCertificate } from './e2e/support/stand-ins/tls'

/**
 * The support module suite: tests under e2e/tests/support, run against a
 * PRODUCTION build (`bun run build` first) with the suite's own environment
 * (e2e/support/support.env) and local stand-ins for mail, AI, webhooks and
 * storage. See e2e/tests/support/README.md.
 *
 * Tags: `@smoke` (every PR), `@core` (support changes, main, nightly),
 * `@nightly` (nightly only). Projects are named `support-setup` and `support`.
 */
const env = supportEnv()

// The sink certificate must exist before the app starts, since the app reads
// NODE_EXTRA_CA_CERTS once at boot. Idempotent.
ensureSinkCertificate(env.sinkCertPath, env.sinkKeyPath)

// What the e2e scripts (db-helpers) and test workers read: the suite's env
// file instead of the repo-root .env, with the derived and overridden values
// set here (bun prefers the environment over --env-file).
process.env.E2E_ENV_FILE = SUPPORT_ENV_FILE
for (const key of [
  'DATABASE_URL',
  'SECRET_KEY',
  'BASE_URL',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'EMAIL_INBOUND_DOMAIN',
  'EMAIL_INBOUND_SIGNING_SECRET',
] as const) {
  process.env[key] = env.app[key]
}

// Never reuse a server silently: a stale one is the classic false result.
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === '1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry on CI so a flaky test shows as flaky in the report instead of
  // failing the job; the every-PR set only becomes required once it runs two
  // weeks with none.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['blob', { outputDir: 'blob-report' }], ['list']]
    : [['html', { outputFolder: 'playwright-report-support', open: 'never' }], ['list']],
  use: {
    baseURL: env.baseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'support-setup',
      testMatch: /support\/setup\.support\.ts/,
    },
    {
      name: 'support',
      testMatch: /tests\/support\/.+\.spec\.ts/,
      dependencies: ['support-setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command: 'bun e2e/support/stand-ins/fake-ai.ts',
      url: `${env.fakeAiUrl}/__fake/health`,
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: 'bun e2e/support/stand-ins/webhook-sink.ts',
      url: `${env.sinkControlUrl}/__sink/health`,
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: 'bun e2e/support/start-app.ts',
      url: `${env.baseUrl}/api/health/ready`,
      reuseExistingServer,
      timeout: 120_000,
    },
  ],
  timeout: 30_000,
  expect: { timeout: 7_000 },
})
