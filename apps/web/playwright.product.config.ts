import { defineConfig, devices } from '@playwright/test'
import { SUPPORT_ENV_FILE, supportEnv } from './e2e/support/env'
import { ensureSinkCertificate } from './e2e/support/stand-ins/tls'

/**
 * The product suite: feedback, roadmap, changelog, status page, help center,
 * people and the platform around them (API, MCP, webhooks, integrations).
 * Tests live under e2e/tests/<module>/ and run against a PRODUCTION build
 * (`bun run build` first) with the same environment and stand-ins as the
 * support suite (e2e/support/support.env: Mailpit, fake AI, webhook sink,
 * object storage, sweep runner) plus the provider fake and the OIDC fake. See
 * e2e/tests/product/README.md.
 *
 * Tags: `@smoke` (every PR), `@core` (product changes, main, nightly),
 * `@nightly` (nightly only), `@isolated` (workspace-wide switches, own job),
 * `@quarantine` (see e2e/QUARANTINE.md).
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

/** The module folders under e2e/tests/ this suite owns. */
const PRODUCT_MODULES = [
  'status',
  'feedback',
  'roadmap',
  'changelog',
  'help-center',
  'people',
  'platform',
  'product',
] as const

const MODULE_SPECS = new RegExp(`tests/(${PRODUCT_MODULES.join('|')})/.+\\.spec\\.ts$`)
// Specs that need the workspace to themselves: `*.serial.spec.ts`.
const SERIAL_SPECS = new RegExp(`tests/(${PRODUCT_MODULES.join('|')})/.+\\.serial\\.spec\\.ts$`)

// CI runs the two projects as two invocations into one blob folder; the
// second names its report so the first one's survives.
const blobFileName = process.env.PRODUCT_BLOB_FILE_NAME

const browser = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1600, height: 1000 },
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry on CI so a flaky test shows as flaky in the report instead of
  // failing the job.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [
        [
          'blob',
          {
            outputDir: process.env.PRODUCT_BLOB_DIR ?? 'blob-report',
            ...(blobFileName ? { fileName: blobFileName } : {}),
          },
        ],
        ['list'],
      ]
    : [['html', { outputFolder: 'playwright-report-product', open: 'never' }], ['list']],
  use: {
    baseURL: env.baseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'product-setup',
      testMatch: /product\/setup\.product\.ts/,
    },
    {
      name: 'product',
      testMatch: MODULE_SPECS,
      testIgnore: SERIAL_SPECS,
      dependencies: ['product-setup'],
      use: browser,
    },
    // One worker, run as its own invocation after `product`
    // (`--project product-serial`), so no other test is running meanwhile.
    {
      name: 'product-serial',
      testMatch: SERIAL_SPECS,
      dependencies: ['product-setup'],
      workers: 1,
      use: browser,
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
    // Product-only stand-ins: the integrations' providers and a single sign-on
    // provider (e2e/tests/product/README.md, "Stand-ins").
    {
      command: 'bun e2e/support/stand-ins/fake-provider.ts',
      url: `${env.providerFakeUrl}/__fake/health`,
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: 'bun e2e/support/stand-ins/fake-oidc.ts',
      url: `${env.oidcFakeControlUrl}/__oidc/health`,
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
