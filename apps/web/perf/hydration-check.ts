/**
 * Server-rendered pages must hydrate cleanly for a visitor whose time zone and
 * locale differ from the server's: a date or number formatted on the server in
 * its own zone or locale, then again in the browser, is a hydration mismatch
 * (minified React errors 418, 423 and 425).
 *
 * Boots the production build against the bench database like bench.ts, loads
 * every server-rendered page in a browser set to a far time zone and another
 * locale, and fails on any hydration or page error.
 *
 *   bun perf/hydration-check.ts
 */
import { chromium, type BrowserContext } from '@playwright/test'
import { ADMIN, BENCH_DATABASE_URL, BENCH_PORT } from './config'

const appDir = process.env.PERF_APP_DIR ?? new URL('..', import.meta.url).pathname
const baseURL = `http://localhost:${BENCH_PORT}`

const PAGES: { path: string; as: 'anon' | 'admin' }[] = [
  { path: '/?sort=trending', as: 'anon' },
  { path: '/roadmap', as: 'anon' },
  { path: '/changelog', as: 'anon' },
  { path: '/hc', as: 'anon' },
  { path: '/?sort=trending', as: 'admin' },
  { path: '/admin/feedback', as: 'admin' },
  { path: '/admin/inbox', as: 'admin' },
  { path: '/admin/roadmap', as: 'admin' },
  { path: '/admin/users?sort=newest', as: 'admin' },
  { path: '/admin/changelog', as: 'admin' },
  { path: '/admin/help-center', as: 'admin' },
  { path: '/admin/moderation', as: 'admin' },
  { path: '/admin/notifications', as: 'admin' },
  { path: '/admin/analytics', as: 'admin' },
  { path: '/admin/automation', as: 'admin' },
  { path: '/admin/automation/performance', as: 'admin' },
  { path: '/admin/automation/workflows', as: 'admin' },
  { path: '/admin/settings/members', as: 'admin' },
  { path: '/admin/settings/portal', as: 'admin' },
  { path: '/admin/settings/widget', as: 'admin' },
]

// Hydration mismatch in React's minified production errors, or the
// development wording.
const HYDRATION = /Minified React error #(418|423|425)|hydrat/i

const server = Bun.spawn(['bun', '.output/server/index.mjs'], {
  cwd: appDir,
  env: {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NODE_ENV: 'production',
    TZ: 'UTC',
    PORT: String(BENCH_PORT),
    BASE_URL: baseURL,
    DATABASE_URL: BENCH_DATABASE_URL,
    SECRET_KEY: process.env.PERF_SECRET_KEY ?? 'perf-bench-secret-key-local-and-ci-only-0000',
    QUACKBACK_ROLE: 'web',
    LOG_LEVEL: 'warn',
  },
  stdout: 'ignore',
  stderr: 'ignore',
})

let failures = 0
try {
  for (let i = 0; i < 60; i++) {
    if ((await fetch(`${baseURL}/api/health/ready`).catch(() => null))?.ok) break
    await Bun.sleep(500)
  }
  const browser = await chromium.launch()
  const contextFor = async (as: 'anon' | 'admin'): Promise<BrowserContext> => {
    const context = await browser.newContext({
      baseURL,
      timezoneId: 'Pacific/Kiritimati',
      locale: 'de-DE',
    })
    if (as === 'admin') {
      const res = await context.request.post('/api/auth/sign-in/email', {
        data: ADMIN,
        headers: { origin: baseURL },
      })
      if (!res.ok()) throw new Error(`admin sign-in failed: ${res.status()}`)
    }
    return context
  }
  const contexts = { anon: await contextFor('anon'), admin: await contextFor('admin') }

  const problemsLoading = async (context: BrowserContext, path: string, corrupt = false) => {
    const page = await context.newPage()
    const problems: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && HYDRATION.test(msg.text()))
        problems.push(msg.text().slice(0, 200))
    })
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message.slice(0, 200)}`))
    if (corrupt) {
      // Change one server-rendered text node on its way to the browser, so the
      // browser's render disagrees with the markup it hydrates.
      await page.route(`**${path}`, async (route) => {
        const response = await route.fetch()
        const original = await response.text()
        const html = original.replace('>Acme Corp<', '>Acme Corp (server)<')
        if (html === original) problems.push('self-test could not find the text to corrupt')
        await route.fulfill({ response, body: html })
      })
    }
    await page.goto(path, { waitUntil: 'load' })
    await page.waitForTimeout(1500)
    await page.close()
    return problems
  }

  // The check must be able to fail: a deliberately mismatched document has to
  // be reported, or every pass below means nothing.
  const selfTest = await problemsLoading(contexts.anon, '/?sort=trending', true)
  const detected = selfTest.find((problem) => HYDRATION.test(problem))
  if (!detected) {
    console.log(`✗ self-test: a corrupted document was not reported as a hydration error`)
    for (const problem of selfTest) console.log(`    ${problem}`)
    failures++
  } else {
    console.log(`✓ self-test: a corrupted document is reported (${detected.slice(0, 60)}...)`)
  }

  for (const { path, as } of PAGES) {
    const problems = await problemsLoading(contexts[as], path)
    if (problems.length) {
      failures++
      console.log(`✗ ${as} ${path}`)
      for (const p of problems) console.log(`    ${p}`)
    } else {
      console.log(`✓ ${as} ${path}`)
    }
  }
  await browser.close()
} finally {
  server.kill()
}
process.exit(failures ? 1 : 0)
