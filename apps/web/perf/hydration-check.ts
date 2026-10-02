/**
 * Server-rendered pages must hydrate cleanly for a visitor whose time zone and
 * locale differ from the server's: a date or number formatted on the server in
 * its own zone or locale, then again in the browser, is a hydration mismatch
 * (minified React errors 418, 423 and 425).
 *
 * Boots the production build against the bench database like bench.ts, loads
 * every server-rendered page as two visitors in far time zones and other
 * locales, and fails on any hydration or page error. Between them the two
 * zones move every UTC hour onto another day: UTC+14 moves 10:00 to 23:59 UTC
 * into the next day and UTC-11 moves 00:00 to 10:59 UTC into the previous one,
 * so a date formatted in the server's zone fails whatever time of day the
 * bench data was seeded.
 *
 *   bun perf/hydration-check.ts
 */
import { chromium, type BrowserContext } from '@playwright/test'
import postgres from 'postgres'
import { fromUuid } from '@quackback/ids'
import { BENCH_DATABASE_URL, BENCH_URL, signedInContext, startBenchServer } from './config'

const appDir = process.env.PERF_APP_DIR ?? new URL('..', import.meta.url).pathname
const baseURL = BENCH_URL

/**
 * The inbox with a seeded conversation open, as a deep link renders it: the
 * thread and its detail panel come with the document. Seeded ids differ per
 * database, so the conversation is looked up by its subject.
 */
async function seededConversationPath(subject: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    (sql) => sql`SELECT id FROM conversations WHERE subject = ${subject}`
  )
  if (!row) throw new Error(`no seeded conversation "${subject}"`)
  return `/admin/inbox?i=${fromUuid('conversation', row.id)}`
}

/** The newest published changelog entry's public page. */
async function latestChangelogPath(): Promise<string> {
  const [row] = await query<{ id: string }>(
    (sql) => sql`
      SELECT id FROM changelog_entries
      WHERE published_at <= now() AND deleted_at IS NULL
      ORDER BY published_at DESC, id LIMIT 1`
  )
  if (!row) throw new Error('no published changelog entry')
  return `/changelog/${fromUuid('changelog', row.id)}`
}

async function query<T>(run: (sql: postgres.Sql) => Promise<unknown>): Promise<T[]> {
  const sql = postgres(BENCH_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    return (await run(sql)) as T[]
  } finally {
    await sql.end()
  }
}

const PAGES: { path: string | (() => Promise<string>); as: 'anon' | 'admin' }[] = [
  { path: '/?sort=trending', as: 'anon' },
  { path: '/roadmap', as: 'anon' },
  { path: '/changelog', as: 'anon' },
  { path: latestChangelogPath, as: 'anon' },
  { path: '/hc', as: 'anon' },
  { path: '/?sort=trending', as: 'admin' },
  { path: '/admin/feedback', as: 'admin' },
  // A date filter is a calendar day, the same for every visitor. The day is
  // long past, so no relative preset ("Last 7 days") names it instead.
  { path: '/admin/feedback?dateFrom=2025-01-15', as: 'admin' },
  { path: '/admin/inbox', as: 'admin' },
  { path: () => seededConversationPath('Bench conversation 3'), as: 'admin' },
  { path: '/admin/roadmap', as: 'admin' },
  { path: '/admin/users?sort=newest', as: 'admin' },
  { path: '/admin/users?dateFrom=2025-01-15&dateTo=2025-02-15', as: 'admin' },
  { path: '/admin/changelog', as: 'admin' },
  { path: '/admin/help-center', as: 'admin' },
  { path: '/admin/feedback/moderation', as: 'admin' },
  { path: '/admin/notifications', as: 'admin' },
  { path: '/admin/analytics', as: 'admin' },
  { path: '/admin/settings/agent', as: 'admin' },
  { path: '/admin/settings/connectors', as: 'admin' },
  { path: '/admin/settings/copilot', as: 'admin' },
  { path: '/admin/settings/skills', as: 'admin' },
  { path: '/admin/settings/workflows', as: 'admin' },
  { path: '/admin/settings/members', as: 'admin' },
  { path: '/admin/settings/security/audit-log', as: 'admin' },
  { path: '/admin/settings/portal', as: 'admin' },
  { path: '/admin/settings/widget', as: 'admin' },
]

// Hydration mismatch in React's minified production errors, or the
// development wording.
const HYDRATION = /Minified React error #(418|423|425)|hydrat/i

const server = await startBenchServer(appDir, { env: { TZ: 'UTC', LOG_LEVEL: 'warn' } })

let failures = 0
try {
  const browser = await chromium.launch()
  const [east, west] = [
    { timezoneId: 'Pacific/Kiritimati', locale: 'de-DE' },
    { timezoneId: 'Pacific/Pago_Pago', locale: 'fr-FR' },
  ]
  const eastAdmin = await signedInContext(browser, baseURL, east)
  // One sign-in serves both visitors, as the bench's one sign-in serves its
  // journeys: sign-ins are rate limited per address.
  const adminSession = await eastAdmin.storageState()
  const visitors = [
    {
      name: 'UTC+14 de-DE',
      anon: await browser.newContext({ ...east, baseURL }),
      admin: eastAdmin,
    },
    {
      name: 'UTC-11 fr-FR',
      anon: await browser.newContext({ ...west, baseURL }),
      admin: await browser.newContext({ ...west, baseURL, storageState: adminSession }),
    },
  ]

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
  const selfTest = await problemsLoading(visitors[0].anon, '/?sort=trending', true)
  const detected = selfTest.find((problem) => HYDRATION.test(problem))
  if (!detected) {
    console.log(`✗ self-test: a corrupted document was not reported as a hydration error`)
    for (const problem of selfTest) console.log(`    ${problem}`)
    failures++
  } else {
    console.log(`✓ self-test: a corrupted document is reported (${detected.slice(0, 60)}...)`)
  }

  for (const { path: pathOrLookup, as } of PAGES) {
    const path = typeof pathOrLookup === 'string' ? pathOrLookup : await pathOrLookup()
    for (const visitor of visitors) {
      const problems = await problemsLoading(visitor[as], path)
      if (problems.length) {
        failures++
        console.log(`✗ ${as} ${path} (${visitor.name})`)
        for (const p of problems) console.log(`    ${p}`)
      } else {
        console.log(`✓ ${as} ${path} (${visitor.name})`)
      }
    }
  }
  await browser.close()
} finally {
  server.kill()
}
process.exit(failures ? 1 : 0)
