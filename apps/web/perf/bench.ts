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
 *   bun perf/bench.ts --throttle ...   browser journeys over a 10 Mbps, 40 ms link
 *   bun perf/bench.ts --core           skip the breadth sweep over every page
 *   bun perf/bench.ts --renders ...    list the components that rendered most (build with
 *                                      PERF_UNMINIFIED=1 for readable names)
 *   PERF_APP_DIR=../other/apps/web bun perf/bench.ts   bench another build
 *   bun perf/bench.ts --trace --only ui:portal-load
 *                                      list the SQL behind the journey, most repeated first,
 *                                      then each server request (server functions by name)
 *
 * Every journey's warm-up call is also the first request this freshly booted
 * server has handled for it, so its db_queries is printed as a "cold:" line
 * whenever it differs from the steady-state count. This is not a from-nothing
 * count: the bench's own admin sign-in (below) and any journey earlier in
 * `selected` already warmed whatever process-level state they share with it.
 * For the genuine cold number, hit the route directly against a server that
 * has handled nothing else yet.
 *
 * Exit code 1 means a count went over its ceiling (or a journey broke).
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Frame,
  type Page,
} from '@playwright/test'
import { parseArgs } from 'node:util'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    throttle: { type: 'boolean', default: false },
    core: { type: 'boolean', default: false },
    renders: { type: 'boolean', default: false },
  },
})

// PERF_APP_DIR benches another checkout's build with these journeys, which is
// how a before/after comparison runs on identical instruments.
const appDir = process.env.PERF_APP_DIR ?? new URL('..', import.meta.url).pathname
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
const statements = new Map<string, { sql: string; route?: string }[]>()

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
      // The settings copy a process keeps for a few seconds would make a count
      // depend on timing; held for the whole run, counts measure a warm process.
      QUACKBACK_SETTINGS_CACHE_MS: String(60 * 60 * 1000),
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
          statements.set(id, [
            ...(statements.get(id) ?? []),
            { sql: record.sql, route: record.route },
          ])
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
  window.__perfRenders = 0
  window.__perfByComponent = Object.create(null)

  // Component renders per commit, counted the way React DevTools decides a
  // fiber rendered: a subtree whose children were not reconciled this commit
  // (the same child fiber as before) was reused and is skipped; a component
  // fiber counts when it mounted or carries the PerformedWork flag. Tags:
  // 0 function, 1 class, 11 forwardRef, 15 simple memo (14, the memo wrapper,
  // would double count its inner component).
  const COMPONENT_TAGS = new Set([0, 1, 11, 15])
  const PERFORMED_WORK = 1
  const nameOf = (fiber) => {
    const type = fiber.type
    if (!type) return 'Anonymous'
    return (
      type.displayName || type.name ||
      (type.render && (type.render.displayName || type.render.name)) ||
      'Anonymous'
    )
  }
  const countRenders = (root) => {
    const stack = [root]
    while (stack.length) {
      const fiber = stack.pop()
      const previous = fiber.alternate
      const rendered = previous === null || (fiber.flags & PERFORMED_WORK) !== 0
      if (COMPONENT_TAGS.has(fiber.tag) && rendered) {
        window.__perfRenders++
        const name = nameOf(fiber)
        window.__perfByComponent[name] = (window.__perfByComponent[name] || 0) + 1
      }
      if (fiber.sibling) stack.push(fiber.sibling)
      if (fiber.child && (previous === null || fiber.child !== previous.child)) stack.push(fiber.child)
    }
  }

  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(id, root) {
      window.__perfCommits++
      try { countRenders(root.current) } catch {}
    },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    checkDCE() {},
  }
  performance.setResourceTimingBufferSize(100000)
`

interface FrameSnapshot {
  at: number
  commits: number
  renders: number
  byComponent: Record<string, number>
  elements: number
  resources: { name: string; type: string; bytes: number; start: number }[]
}

interface PageSnapshot extends FrameSnapshot {
  /**
   * Child frames (an embedded widget iframe, say). Each keeps its own
   * performance timeline and clock, so its work is read inside the frame.
   */
  frames: Map<Frame, FrameSnapshot>
}

function frameSnapshot(frame: Frame, withNavigation: boolean): Promise<FrameSnapshot> {
  return frame.evaluate(
    (navigation) => ({
      at: performance.now(),
      commits: (window as unknown as { __perfCommits: number }).__perfCommits,
      renders: (window as unknown as { __perfRenders: number }).__perfRenders,
      byComponent: {
        ...(window as unknown as { __perfByComponent: Record<string, number> }).__perfByComponent,
      },
      elements: document.getElementsByTagName('*').length,
      resources: (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .concat(
          navigation
            ? (performance.getEntriesByType('navigation') as PerformanceResourceTiming[])
            : []
        )
        .map((e) => ({
          name: e.name,
          type: e.initiatorType,
          bytes: e.encodedBodySize,
          start: e.startTime,
        })),
    }),
    withNavigation
  )
}

async function snapshot(page: Page): Promise<PageSnapshot> {
  const main = await frameSnapshot(page.mainFrame(), true)
  const frames = new Map<Frame, FrameSnapshot>()
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.isDetached()) continue
    // A child frame's own document is already a resource of its parent.
    const child = await frameSnapshot(frame, false).catch(() => null)
    if (child) frames.set(frame, child)
  }
  return { ...main, frames }
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
  const path = typeof journey.path === 'string' ? journey.path : await journey.path(context.request)
  const started = performance.now()
  const res = await context.request.get(path, {
    headers: { 'x-request-id': id },
    maxRedirects: 0,
    // A document whose stream never ends would otherwise hang the run.
    timeout: 8000,
  })
  const body = await res.body()
  const clientMs = performance.now() - started
  if (res.status() !== 200) {
    const location = res.headers()['location']
    throw new Error(
      `${path} answered ${res.status()}${location ? ` -> ${location}` : ''}, expected 200`
    )
  }
  if (!body.toString('utf8').trimEnd().endsWith('</html>')) {
    throw new Error(`${path} ended before </html>: the document stream did not finish`)
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
  if (args.throttle) {
    // A home broadband link. Localhost has no bandwidth limit, so without this
    // the bytes a change saves never show up as time.
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 40,
      downloadThroughput: (10 * 1024 * 1024) / 8,
      uploadThroughput: (5 * 1024 * 1024) / 8,
    })
  }
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
    let childCommits = 0
    let childRenders = 0
    const byComponent = diffCounts(after.byComponent, before?.byComponent)
    for (const [frame, child] of after.frames) {
      const earlier = before?.frames.get(frame)
      loaded.push(...child.resources.filter((r) => r.start >= (earlier?.at ?? 0)))
      childCommits += child.commits - (earlier?.commits ?? 0)
      childRenders += child.renders - (earlier?.renders ?? 0)
      for (const [name, n] of Object.entries(diffCounts(child.byComponent, earlier?.byComponent))) {
        byComponent[name] = (byComponent[name] ?? 0) + n
      }
    }
    const scripts = loaded.filter((r) => /\.m?js(\?|$)/.test(r.name))
    // Chromium tags the document's own PerformanceNavigationTiming entry
    // with initiatorType "navigation"; a journey whose run() is a
    // client-side transition (no fresh document load) has none, so this
    // is 0 there rather than absent, keeping the metric shape stable.
    const navigation = loaded.find((r) => r.type === 'navigation')
    const work = await serverWork(id)

    const metrics: Metrics = {
      dbQueries: work.dbQueries,
      serverRequests: work.serverRequests,
      requests: loaded.length,
      jsRequests: scripts.length,
      jsKB: kb(scripts.reduce((sum, r) => sum + r.bytes, 0)),
      htmlTransferKB: kb(navigation?.bytes ?? 0),
      reactCommits: after.commits - (before?.commits ?? 0) + childCommits,
      componentRenders: after.renders - (before?.renders ?? 0) + childRenders,
      layouts: cdpAfter.LayoutCount - cdpBefore.LayoutCount,
      styleRecalcs: cdpAfter.RecalcStyleCount - cdpBefore.RecalcStyleCount,
      domElements: after.elements,
    }
    if (opts.instrument) metrics.jsCalls = jsCalls
    return {
      id,
      quiet,
      metrics,
      byComponent,
      timing: {
        doneMs,
        serverMs: work.serverMs,
        scriptMs: (cdpAfter.ScriptDuration - cdpBefore.ScriptDuration) * 1000,
      },
    }
  } finally {
    await context.close()
    await journey.teardown?.()
  }
}

const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10

/** Per-name counts that grew between two snapshots. */
function diffCounts(after: Record<string, number>, before: Record<string, number> = {}) {
  const grown: Record<string, number> = {}
  for (const [name, n] of Object.entries(after)) {
    const delta = n - (before[name] ?? 0)
    if (delta > 0) grown[name] = delta
  }
  return grown
}

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
 * Metrics the budget gates. The counts come out identical on every run; the
 * sizes and component renders can move a little, so they carry a tolerance
 * and are budgeted at their peak across repeats. React commits, layout and
 * style-recalc counts and JS call counts move more than that between runs of
 * the admin journeys, so they are reported, never gated.
 */
const GATED = [
  'dbQueries',
  'serverRequests',
  'requests',
  'jsRequests',
  'jsKB',
  'htmlKB',
  'htmlTransferKB',
  'componentRenders',
]

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

/**
 * Server function ids are hashes; the build's resolver manifest maps each one
 * back to the function's name, so a traced request reads as `getPostFn`
 * rather than `/_serverFn/3f9c...`.
 */
let serverFnNames: Map<string, string> | undefined
function routeLabel(route: string | undefined) {
  if (!route) return '(no route)'
  if (!serverFnNames) {
    serverFnNames = new Map()
    const dir = `${appDir}.output/server`
    const file = readdirSync(dir).find((f) => f.includes('server-fn-resolver'))
    const source = file ? readFileSync(`${dir}/${file}`, 'utf8') : ''
    for (const m of source.matchAll(
      /"([0-9a-f]{64})":\s*\{\s*functionName:\s*"(\w+?)(?:_createServerFn_handler)?"/g
    ))
      serverFnNames.set(m[1]!, m[2]!)
  }
  const id = route.match(/\/_serverFn\/([0-9a-f]{64})/)?.[1]
  return id ? `${route.split(' ')[0]} ${serverFnNames.get(id) ?? id}` : route
}

function printStatements(list: { sql: string }[], indent: string) {
  const counts = new Map<string, number>()
  for (const { sql } of list) {
    const key = normalizeSql(sql)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  for (const [sql, n] of sorted) console.log(`${indent}${String(n).padStart(3)}x  ${sql}`)
}

function printTrace(id: string) {
  const list = statements.get(id) ?? []
  printStatements(list, '    ')
  const requests = finished.get(id) ?? []
  if (requests.length === 0) return
  console.log(`\n    by server request:`)
  const byRoute = new Map<string, { sql: string }[]>()
  for (const s of list) byRoute.set(s.route ?? '', [...(byRoute.get(s.route ?? '') ?? []), s])
  const printed = new Set<string>()
  for (const r of requests) {
    console.log(
      `    - ${routeLabel(r.route)}  db=${r.db_queries ?? 0}  ${r.duration_ms ?? 0}ms  (${r.status ?? '?'})`
    )
    if (r.route && !printed.has(r.route)) {
      printed.add(r.route)
      printStatements(byRoute.get(r.route) ?? [], '          ')
    }
  }
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

async function main() {
  const selected = journeys.filter(
    (j) =>
      (!args.core || !j.sweep) &&
      (!args.only?.length || args.only.some((o) => j.name === o || j.name.startsWith(o)))
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
    // The first call each journey makes here is also the first request this
    // freshly spawned server has handled for it, so its db_queries is close
    // to the cache-fill cost a real deploy or cache expiry pays once:
    // captured for free, since warm-up already makes the call and would
    // otherwise discard the result. Not exact: the admin sign-in just above
    // and any journey run earlier in `selected` already warmed whatever
    // process-level state (an in-memory config cache, say) they share with
    // this one, so the number here is "cold for this journey's own cache
    // entries, warm for anything already touched" rather than a genuine
    // from-nothing count. For that, hit the route directly against a
    // freshly started server before the bench (or anything else) runs.
    const coldMetrics: Record<string, Metrics> = {}
    process.stdout.write('warming up')
    for (const journey of selected) {
      const result = await measure(journey, false).catch(() => null)
      if (result) coldMetrics[journey.name] = result.metrics
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
          if (args.renders && r === 0 && 'byComponent' in result) {
            console.log(`\n  ${journey.name}: ${result.metrics.componentRenders} component renders`)
            const top = Object.entries(result.byComponent)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
            for (const [name, n] of top) console.log(`    ${String(n).padStart(5)}x  ${name}`)
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
      {
        metrics: Metrics
        unstable: string[]
        peaks: Metrics
        timing?: Record<string, number>
      }
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
      const peaks = Object.fromEntries(
        Object.keys(metrics).map((m) => [m, Math.max(...measured.map((run) => run[m]!))])
      ) as Metrics
      const timing: Record<string, number> = {}
      for (const key of Object.keys(timings[name]?.[0] ?? {})) {
        const values = timings[name]!.map((t) => t[key]!)
        timing[`${key}.p50`] = Math.round(percentile(values, 50))
        timing[`${key}.p90`] = Math.round(percentile(values, 90))
      }
      results[name] = { metrics, unstable, peaks, timing: timingRuns ? timing : undefined }

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
      const coldQueries = coldMetrics[name]?.dbQueries
      if (coldQueries !== undefined && coldQueries !== metrics.dbQueries) {
        console.log(`    cold: dbQueries=${coldQueries}`)
      }
      if (process.env.GITHUB_ACTIONS === 'true') {
        for (const row of rows) {
          if (row.verdict === 'over') {
            console.log(
              `::error title=Performance budget::${name} ${row.metric}=${row.value} is over its ceiling of ${row.ceiling}`
            )
          } else if (row.verdict === 'under') {
            console.log(
              `::notice title=Performance ratchet::${name} ${row.metric}=${row.value} is under its ceiling of ${row.ceiling}; lower it with \`bun run --cwd apps/web perf --update\``
            )
          }
        }
      }
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
      for (const [name, { metrics, unstable, peaks }] of Object.entries(results)) {
        const current = (budgets.journeys[name] ??= {})
        for (const metric of GATED) {
          // A reading that moved between repeats is budgeted at its peak when
          // the metric has a tolerance to absorb the spread, and not at all
          // otherwise.
          const shaky = unstable.includes(metric)
          if (shaky && budgets.tolerance[metric] === undefined) continue
          const value = shaky ? peaks[metric] : metrics[metric]
          if (value === undefined) continue
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
