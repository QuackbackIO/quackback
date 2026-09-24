/**
 * Performance bench: deterministic counts for the journeys users take.
 *
 * Wall-clock time is noisy; counts are not. The same page against the same
 * data runs the same number of queries, ships the same bytes of JavaScript and
 * commits React the same number of times, so one run can be compared against a
 * checked-in ceiling and a regression fails at once. Timing is still reported
 * (--timing) so a count can be shown to track the latency users feel.
 *
 * It boots the production build (`bun run build` first) against the bench
 * database (`bun perf/setup-db.ts`) and reads per-request query counts from the
 * server's own log, which QUACKBACK_SERVER_TIMING=1 makes complete.
 *
 *   bun perf/bench.ts                  measure, compare with budgets.json
 *   bun perf/bench.ts --update         lower every ceiling a journey came in under
 *   bun perf/bench.ts --repeat 3       run 3 times and flag any count that moved
 *   bun perf/bench.ts --timing 20      add median/p90 wall time per journey
 *   bun perf/bench.ts --trace --only ui:portal-load
 *                                      list the SQL behind the journey, most repeated first
 *
 * Exit code 1 means a count went over its ceiling (or a journey broke).
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { parseArgs } from 'node:util'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { journeys, type Actor, type BrowserJourney, type DocumentJourney } from './journeys'
import { ADMIN, BENCH_DATABASE_URL, BENCH_PORT } from './config'

const { values: args } = parseArgs({
  options: {
    update: { type: 'boolean', default: false },
    'allow-increase': { type: 'boolean', default: false },
    repeat: { type: 'string', default: '1' },
    timing: { type: 'string', default: '0' },
    trace: { type: 'boolean', default: false },
    only: { type: 'string', multiple: true },
    headed: { type: 'boolean', default: false },
  },
})

const appDir = new URL('..', import.meta.url).pathname
const perfDir = new URL('.', import.meta.url).pathname
const budgetsPath = `${perfDir}budgets.json`
const baseURL = `http://localhost:${BENCH_PORT}`

type Metrics = Record<string, number>

interface ServerLine {
  msg: string
  request_id?: string
  db_queries?: number
  duration_ms?: number
  status?: number
  route?: string
  sql?: string
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const finished = new Map<string, ServerLine[]>()
const statements = new Map<string, string[]>()

async function startServer() {
  const server = Bun.spawn(['bun', '.output/server/index.mjs'], {
    cwd: appDir,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'production',
      PORT: String(BENCH_PORT),
      BASE_URL: baseURL,
      DATABASE_URL: BENCH_DATABASE_URL,
      SECRET_KEY: process.env.PERF_SECRET_KEY ?? 'perf-bench-secret-key-local-and-ci-only-0000',
      QUACKBACK_ROLE: 'web',
      QUACKBACK_SERVER_TIMING: '1',
      LOG_LEVEL: args.trace ? 'debug' : 'info',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  void (async () => {
    const decoder = new TextDecoder()
    let buffered = ''
    for await (const chunk of server.stdout) {
      buffered += decoder.decode(chunk, { stream: true })
      let newline: number
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        if (!line.startsWith('{')) continue
        let record: ServerLine
        try {
          record = JSON.parse(line)
        } catch {
          continue
        }
        const id = record.request_id
        if (!id) continue
        if (record.msg === 'request finished') {
          finished.set(id, [...(finished.get(id) ?? []), record])
        } else if (record.msg === 'db query' && record.sql) {
          statements.set(id, [...(statements.get(id) ?? []), record.sql])
        }
      }
    }
  })()

  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await fetch(`${baseURL}/api/health/ready`).catch(() => null)
    if (ready?.ok) return server
    if (server.exitCode !== null) break
    await Bun.sleep(500)
  }
  server.kill()
  throw new Error(
    `Server did not become ready on ${baseURL}. Run \`bun run build\` and \`bun perf/setup-db.ts\` first.\n` +
      (await new Response(server.stderr).text()).slice(-2000)
  )
}

async function serverWork(requestId: string, expected?: number) {
  // The finished line is written when the body ends, a hair before the
  // client sees it end; give the log reader a moment to catch up.
  for (let i = 0; i < 40; i++) {
    const lines = finished.get(requestId) ?? []
    if (expected === undefined ? lines.length > 0 : lines.length >= expected) break
    await Bun.sleep(25)
  }
  const lines = finished.get(requestId) ?? []
  return {
    serverRequests: lines.length,
    dbQueries: lines.reduce((sum, l) => sum + (l.db_queries ?? 0), 0),
    serverMs: lines.reduce((sum, l) => sum + (l.duration_ms ?? 0), 0),
    lines,
  }
}

// ---------------------------------------------------------------------------
// Browser instrumentation
// ---------------------------------------------------------------------------

/**
 * Installed before any page script. A minimal devtools hook is enough for
 * React to report each commit, in production builds too; the resource timing
 * buffer is raised because a cold admin load fetches more than the default 250.
 */
const INIT_SCRIPT = `
  window.__perfCommits = 0
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id },
    onScheduleFiberRoot() {},
    onCommitFiberRoot() { window.__perfCommits++ },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    checkDCE() {},
  }
  performance.setResourceTimingBufferSize(100000)
`

interface PageSnapshot {
  at: number
  commits: number
  elements: number
  resources: { name: string; type: string; bytes: number; start: number }[]
}

async function snapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => ({
    at: performance.now(),
    commits: (window as unknown as { __perfCommits: number }).__perfCommits,
    elements: document.getElementsByTagName('*').length,
    resources: (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .concat(performance.getEntriesByType('navigation') as PerformanceResourceTiming[])
      .map((e) => ({
        name: e.name,
        type: e.initiatorType,
        bytes: e.encodedBodySize,
        start: e.startTime,
      })),
  }))
}

async function cdpMetrics(cdp: Awaited<ReturnType<BrowserContext['newCDPSession']>>) {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[]
  }
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}

/** Wait until no request is in flight for `quietMs`, ignoring event streams. */
async function settle(page: Page, inflight: Set<unknown>, quietMs = 500, maxMs = 15000) {
  const deadline = Date.now() + maxMs
  let quietSince = Date.now()
  while (Date.now() < deadline) {
    if (inflight.size > 0) quietSince = Date.now()
    else if (Date.now() - quietSince >= quietMs) break
    await Bun.sleep(50)
  }
  await page.evaluate(
    () => new Promise((resolve) => requestIdleCallback(() => resolve(null), { timeout: 2000 }))
  )
  return inflight.size === 0
}

function trackInflight(page: Page) {
  const inflight = new Set<unknown>()
  page.on('request', (r) => {
    if (r.resourceType() !== 'eventsource') inflight.add(r)
  })
  page.on('response', async (res) => {
    const type = (await res.headerValue('content-type').catch(() => null)) ?? ''
    if (type.includes('text/event-stream')) inflight.delete(res.request())
  })
  page.on('requestfinished', (r) => inflight.delete(r))
  page.on('requestfailed', (r) => inflight.delete(r))
  return inflight
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

let sequence = 0
const nextId = (name: string) => `perf:${name}:${++sequence}`

async function measureDocument(context: BrowserContext, journey: DocumentJourney) {
  const id = nextId(journey.name)
  const started = performance.now()
  const res = await context.request.get(journey.path, {
    headers: { 'x-request-id': id },
    maxRedirects: 0,
  })
  const body = await res.body()
  const clientMs = performance.now() - started
  if (res.status() !== 200) {
    const location = res.headers()['location']
    throw new Error(
      `${journey.path} answered ${res.status()}${location ? ` -> ${location}` : ''}, expected 200`
    )
  }
  const work = await serverWork(id)
  return {
    id,
    metrics: { dbQueries: work.dbQueries, htmlKB: kb(body.length) } as Metrics,
    timing: { serverMs: work.serverMs, clientMs },
  }
}

async function measureBrowser(
  browser: Browser,
  storage: Record<Actor, string | undefined>,
  journey: BrowserJourney,
  opts: { instrument: boolean }
) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    storageState: storage[journey.as],
  })
  await context.addInitScript(INIT_SCRIPT)
  const page = await context.newPage()
  const inflight = trackInflight(page)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (opts.instrument) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  }

  try {
    const setupId = nextId(`${journey.name}:setup`)
    await context.setExtraHTTPHeaders({ 'x-request-id': setupId })
    if (journey.setup) {
      await journey.setup(page)
      await settle(page, inflight)
    } else {
      await page.goto('about:blank')
    }

    const id = nextId(journey.name)
    await context.setExtraHTTPHeaders({ 'x-request-id': id })
    const before = journey.setup ? await snapshot(page) : null
    const cdpBefore = await cdpMetrics(cdp)
    if (opts.instrument) await cdp.send('Profiler.takePreciseCoverage')

    const started = performance.now()
    await journey.run(page)
    const doneMs = performance.now() - started
    const quiet = await settle(page, inflight)

    let jsCalls = 0
    if (opts.instrument) {
      const { result } = (await cdp.send('Profiler.takePreciseCoverage')) as {
        result: { functions: { ranges: { count: number }[] }[] }[]
      }
      for (const script of result)
        for (const fn of script.functions) jsCalls += fn.ranges[0]?.count ?? 0
    }
    const after = await snapshot(page)
    const cdpAfter = await cdpMetrics(cdp)
    const since = before?.at ?? 0
    const loaded = after.resources.filter((r) => r.start >= since)
    const scripts = loaded.filter((r) => /\.m?js(\?|$)/.test(r.name))
    const work = await serverWork(id)

    const metrics: Metrics = {
      dbQueries: work.dbQueries,
      serverRequests: work.serverRequests,
      requests: loaded.length,
      jsRequests: scripts.length,
      jsKB: kb(scripts.reduce((sum, r) => sum + r.bytes, 0)),
      reactCommits: after.commits - (before?.commits ?? 0),
      layouts: cdpAfter.LayoutCount - cdpBefore.LayoutCount,
      styleRecalcs: cdpAfter.RecalcStyleCount - cdpBefore.RecalcStyleCount,
      domElements: after.elements,
    }
    if (opts.instrument) metrics.jsCalls = jsCalls
    return {
      id,
      quiet,
      metrics,
      timing: {
        doneMs,
        serverMs: work.serverMs,
        scriptMs: (cdpAfter.ScriptDuration - cdpBefore.ScriptDuration) * 1000,
      },
    }
  } finally {
    await context.close()
  }
}

const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

interface Budgets {
  $comment?: string
  /** Relative headroom for byte counts, which move with every code change. */
  tolerance: Record<string, number>
  journeys: Record<string, Metrics>
}

function loadBudgets(): Budgets {
  try {
    return JSON.parse(readFileSync(budgetsPath, 'utf8')) as Budgets
  } catch {
    return { tolerance: { htmlKB: 0.05, jsKB: 0.02 }, journeys: {} }
  }
}

/**
 * Metrics the budget gates: the ones that came out identical on every run.
 * React commits, layout and style-recalc counts and JS call counts move by a
 * few between runs of the admin journeys, so they are reported, never gated.
 */
const GATED = ['dbQueries', 'serverRequests', 'requests', 'jsRequests', 'jsKB', 'htmlKB']

function compare(budgets: Budgets, name: string, metrics: Metrics) {
  const ceilings = budgets.journeys[name] ?? {}
  const rows: {
    metric: string
    value: number
    ceiling?: number
    verdict: 'over' | 'under' | 'at' | 'new'
  }[] = []
  for (const [metric, value] of Object.entries(metrics)) {
    const ceiling = ceilings[metric]
    if (!GATED.includes(metric) || ceiling === undefined) {
      rows.push({ metric, value, ceiling, verdict: 'new' })
      continue
    }
    const allowed = ceiling * (1 + (budgets.tolerance[metric] ?? 0))
    const verdict = value > allowed ? 'over' : value < ceiling ? 'under' : 'at'
    rows.push({ metric, value, ceiling, verdict })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').replace(/\$\d+/g, '?').slice(0, 220)
}

function printTrace(id: string) {
  const counts = new Map<string, number>()
  for (const sql of statements.get(id) ?? []) {
    const key = normalizeSql(sql)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  for (const [sql, n] of sorted) console.log(`    ${String(n).padStart(3)}x  ${sql}`)
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

async function main() {
  const selected = journeys.filter(
    (j) => !args.only?.length || args.only.some((o) => j.name === o || j.name.startsWith(o))
  )
  const repeat = Math.max(1, Number(args.repeat))
  const timingRuns = Math.max(0, Number(args.timing))
  const server = await startServer()
  const browser = await chromium.launch({ headless: !args.headed })
  let failed = false

  try {
    const adminContext = await browser.newContext({ baseURL })
    const signIn = await adminContext.request.post('/api/auth/sign-in/email', {
      data: ADMIN,
      headers: { origin: baseURL },
    })
    if (!signIn.ok()) throw new Error(`admin sign-in failed: ${signIn.status()}`)
    const adminState = `${perfDir}.results/admin-state.json`
    mkdirSync(`${perfDir}.results`, { recursive: true })
    await adminContext.storageState({ path: adminState })
    const anonContext = await browser.newContext({ baseURL })
    const contexts: Record<Actor, BrowserContext> = { anon: anonContext, admin: adminContext }
    const storage: Record<Actor, string | undefined> = { anon: undefined, admin: adminState }

    const measure = async (journey: (typeof selected)[number], instrument: boolean) =>
      journey.kind === 'document'
        ? measureDocument(contexts[journey.as], journey)
        : measureBrowser(browser, storage, journey, { instrument })

    // Warm the server's caches and JIT so the measured pass sees steady state.
    process.stdout.write('warming up')
    for (const journey of selected) {
      await measure(journey, false).catch(() => {})
      process.stdout.write('.')
    }
    process.stdout.write('\n')

    const runs: Record<string, Metrics[]> = {}
    const timings: Record<string, Record<string, number>[]> = {}
    const errors: Record<string, string> = {}
    for (let r = 0; r < repeat; r++) {
      for (const journey of selected) {
        try {
          const result = await measure(journey, true)
          ;(runs[journey.name] ??= []).push(result.metrics)
          if ('quiet' in result && !result.quiet) errors[journey.name] = 'network never went quiet'
          if (args.trace && r === 0) {
            console.log(`\n  ${journey.name}: ${result.metrics.dbQueries} queries`)
            printTrace(result.id)
          }
        } catch (err) {
          errors[journey.name] = err instanceof Error ? err.message.split('\n')[0]! : String(err)
        }
      }
    }
    for (let r = 0; r < timingRuns; r++) {
      for (const journey of selected) {
        const result = await measure(journey, false).catch(() => null)
        if (result) (timings[journey.name] ??= []).push(result.timing)
      }
    }

    const budgets = loadBudgets()
    const results: Record<
      string,
      { metrics: Metrics; unstable: string[]; timing?: Record<string, number> }
    > = {}
    console.log('')
    for (const journey of selected) {
      const name = journey.name
      if (errors[name] && !runs[name]) {
        console.log(`✗ ${name}: ${errors[name]}`)
        failed = true
        continue
      }
      const measured = runs[name]!
      const metrics = measured[0]!
      const unstable = Object.keys(metrics).filter((m) =>
        measured.some((run) => run[m] !== metrics[m])
      )
      const timing: Record<string, number> = {}
      for (const key of Object.keys(timings[name]?.[0] ?? {})) {
        const values = timings[name]!.map((t) => t[key]!)
        timing[`${key}.p50`] = Math.round(percentile(values, 50))
        timing[`${key}.p90`] = Math.round(percentile(values, 90))
      }
      results[name] = { metrics, unstable, timing: timingRuns ? timing : undefined }

      const rows = compare(budgets, name, metrics)
      const over = rows.filter((row) => row.verdict === 'over')
      // A run that never settled (or failed on a repeat) counted a partial
      // journey, so its numbers cannot pass.
      if (over.length || errors[name]) failed = true
      const mark = over.length || errors[name] ? '✗' : '✓'
      const cells = rows.map((row) => {
        const flag =
          row.verdict === 'over'
            ? ` ▲ over ${row.ceiling}`
            : row.verdict === 'under'
              ? ` ▼ from ${row.ceiling}`
              : ''
        const shaky = unstable.includes(row.metric)
          ? ` ~[${measured.map((m) => m[row.metric]).join(',')}]`
          : ''
        return `${row.metric}=${row.value}${flag}${shaky}`
      })
      console.log(`${mark} ${name}${errors[name] ? `  (${errors[name]})` : ''}`)
      console.log(`    ${cells.join('  ')}`)
      if (timingRuns) {
        console.log(
          `    timing: ${Object.entries(timing)
            .map(([k, v]) => `${k}=${v}ms`)
            .join('  ')}`
        )
      }
    }

    writeFileSync(`${perfDir}.results/latest.json`, JSON.stringify(results, null, 2))

    if (args.update) {
      for (const [name, { metrics, unstable }] of Object.entries(results)) {
        const current = (budgets.journeys[name] ??= {})
        for (const metric of GATED) {
          const value = metrics[metric]
          if (value === undefined || unstable.includes(metric)) continue
          const ceiling = current[metric]
          if (ceiling === undefined || value < ceiling || args['allow-increase'])
            current[metric] = value
        }
      }
      budgets.$comment =
        'Ceilings for bun perf/bench.ts. Lowered with --update whenever a journey comes in under; ' +
        'raised only with --update --allow-increase, which a reviewer should question.'
      writeFileSync(budgetsPath, JSON.stringify(budgets, null, 2) + '\n')
      console.log(`\nUpdated ${budgetsPath}`)
    }
  } finally {
    await browser.close()
    server.kill()
  }
  process.exit(failed && !args.update ? 1 : 0)
}

await main()
