/**
 * The `deferred-index-build` job, and the "upgrade work done" line.
 *
 * Indexes nothing needs at boot are built after the server listens: each
 * schedule pass enqueues one row per missing or invalid index, and a row builds
 * only its own index, concurrently, healing an invalid copy first. A build that
 * keeps failing gets a new row only a day after its last one ended, and after
 * five such rounds the pass stops for that index with a warning that names it.
 * The first pass after a worker restart starts the count again.
 *
 * Real Postgres, on a database of this suite's own: `CREATE INDEX CONCURRENTLY`
 * waits for every transaction in its database that is older than the build, so
 * on the shared test database it would wait on whatever other suites hold open.
 * Each test builds indexes on a scratch table of its own.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeHarness, rowsFor } from '@/lib/server/jobs/__tests__/harness'

// A single-workspace install builds on DATABASE_URL, read through the app config,
// and the harness connects to it too: both point at this suite's database.
const own = vi.hoisted(() => {
  if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
  process.env.SECRET_KEY ??= 'test-secret-key-for-deferred-index-build-0123456789'
  // The suite's own database (see OwnDatabase in ./harness).
  const shared =
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  const name = `qb_deferred_index_${process.pid}_${Date.now().toString(36)}`
  const url = new URL(shared)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { shared, name, url: url.toString() }
})

vi.mock('@/lib/server/db', async (importOriginal) => {
  const { testDb } = await import('@/lib/server/jobs/__tests__/harness')
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: new Proxy(
      {},
      {
        get(_t, prop) {
          const handle = testDb()
          const value = Reflect.get(handle as object, prop, handle)
          return typeof value === 'function' ? value.bind(handle) : value
        },
      }
    ),
  }
})

const ledger = vi.hoisted(() => ({ applied: new Set<string>() }))
vi.mock('@/lib/server/fleet/schema-floor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/fleet/schema-floor')>()),
  migrationAppliedIn: async (_reader: unknown, tag: string) => ledger.applied.has(tag),
}))

const { logLines, stubLogger } = vi.hoisted(() => {
  const logLines: Array<{ level: string; msg: string; fields: Record<string, unknown> }> = []
  const capture = (level: string) => (fields: object | string, msg?: string) => {
    if (typeof fields === 'string') logLines.push({ level, msg: fields, fields: {} })
    else logLines.push({ level, msg: msg ?? '', fields: fields as Record<string, unknown> })
  }
  const stubLogger = {
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    debug: capture('debug'),
    child() {
      return stubLogger
    },
  }
  return { logLines, stubLogger }
})
vi.mock('@/lib/server/logger', () => ({ logger: stubLogger }))

import type { ConcurrentIndexSpec } from '@/lib/server/db'
import { JOB_DEFINITIONS, __setJobDefinitionsForTests } from '@/lib/server/jobs/definitions'
import {
  createScheduleState,
  drainOnce,
  resetJobHandlers,
  runnerConfig,
  runScheduleTick,
} from '@/lib/server/jobs/runner'
import { slotKey } from '@/lib/server/jobs/cron'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { __setBackfillsForTests, walkBackfill } from '../batched'
import {
  __resetDeferredIndexPassesForTests,
  __setDeferredIndexSpecsForTests,
  deferredIndexBuildDue,
  enqueueDeferredIndexBuilds,
} from '../deferred-indexes'
import { runDeferredIndexJob } from '../deferred-index-build-queue'
import { runBackfillFollowUpJob } from '../follow-up-queue'
import { noteUpgradeWorkDone } from '../upgrade-done'
import {
  createOwnDatabase,
  createScratchTable,
  dropOwnDatabase,
  sampleBackfill,
  testDb,
  testSql,
  uniqueName,
} from './harness'

const QUEUE = 'deferred-index-build'
const CONFIG = { ...runnerConfig(), batchSize: 10 }
const TAG = '9999_sample_backfill_migration'

let table = ''
const specNames: string[] = []

/** A spec for an index on this test's scratch table. */
function spec(label: string, ddlBody?: string): ConcurrentIndexSpec {
  const name = `${table}_${label}_idx`
  specNames.push(name)
  return {
    name,
    concurrent: true,
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON ${ddlBody ?? `${table} (v)`}`,
  }
}

async function indexState(name: string): Promise<'valid' | 'invalid' | 'missing'> {
  const rows = await testSql()<{ indisvalid: boolean }[]>`
    SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(${name})
  `
  if (rows.length === 0) return 'missing'
  return rows[0].indisvalid ? 'valid' : 'invalid'
}

async function rowsOf(name: string) {
  return (await rowsFor(QUEUE)).filter((r) => r.dedupe_key?.startsWith(`${QUEUE}:${name}:`))
}

async function failForGood(dedupeKey: string, finishedAgoMs = 0): Promise<void> {
  await testSql()`
    UPDATE job_queue
    SET status = 'failed', attempts = max_attempts, locked_until = NULL, lease_token = NULL,
        locked_by = NULL, finished_at = now() - make_interval(secs => ${finishedAgoMs / 1000})
    WHERE dedupe_key = ${dedupeKey}
  `
}

/** The generation the pass last enqueued for an index. */
async function currentGen(name: string): Promise<number | null> {
  const rows = await testSql()<{ value: number }[]>`
    SELECT value FROM kv_store WHERE key = ${`${QUEUE}:${name}:gen`} AND expires_at > now()
  `
  return rows[0]?.value ?? null
}

/** Age a spec's terminal row past the one-day cool-off. */
async function ageTerminalRows(name: string): Promise<void> {
  await testSql()`
    UPDATE job_queue SET finished_at = now() - interval '25 hours'
    WHERE dedupe_key LIKE ${`${QUEUE}:${name}:%`} AND status IN ('succeeded', 'failed')
  `
}

function onlyIndexQueue(): void {
  const def = JOB_DEFINITIONS.find((d) => d.name === QUEUE)
  if (!def) throw new Error(`no job definition ${QUEUE}`)
  __setJobDefinitionsForTests([def])
}

/** Claim and run every due index row until none is left, making retries due at once. */
async function drainAll(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await testSql()`
      UPDATE job_queue SET run_at = now() WHERE queue = ${QUEUE} AND status = 'pending'
        AND dedupe_key = ANY(${specNames.flatMap((n) => [1, 2, 3, 4, 5, 6, 7].map((g) => `${QUEUE}:${n}:${g}`))}::text[])
    `
    const result = await drainOnce(CONFIG)
    if (result.claimed === 0) return
  }
}

function cronRow(): ClaimedJob {
  return {
    id: '0',
    jobId: 'job_cron',
    queue: QUEUE,
    dedupeKey: null,
    payload: { scheduledFor: new Date().toISOString() },
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 5,
    leaseToken: 'x',
    lockedUntil: new Date(),
    runAt: new Date(),
  }
}

/**
 * Two instants one hour apart at minute `minute` of an hour no other run uses,
 * so a schedule adopts the first slot and enqueues the second.
 */
function slotPair(minute: number): [Date, Date] {
  const hour = Date.UTC(2040, 0, 1) + Math.floor(Math.random() * 1e6) * 3_600_000
  const first = new Date(hour + minute * 60_000 + 30_000)
  return [first, new Date(first.getTime() + 3_600_000)]
}

/** The dedupe key the schedule writes for the slot `at` falls in. */
function slotDedupeKey(queue: string, at: Date): string {
  return slotKey(queue, new Date(Math.floor(at.getTime() / 60_000) * 60_000))
}

beforeAll(() => createOwnDatabase(own), 240_000)

beforeEach(async () => {
  table = `t_deferred_${process.pid}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`
  await testSql().unsafe(`CREATE TABLE ${table} (id serial PRIMARY KEY, v int)`)
  await testSql().unsafe(`INSERT INTO ${table} (v) SELECT g FROM generate_series(1, 50) g`)
  ledger.applied = new Set([TAG])
  __resetDeferredIndexPassesForTests()
})

afterEach(async () => {
  __setDeferredIndexSpecsForTests(null)
  __setBackfillsForTests(null)
  __setJobDefinitionsForTests(null)
  resetJobHandlers()
  logLines.length = 0
  // Rows a test left pending must not be claimed by the next test's drain.
  await testSql()`DELETE FROM job_queue WHERE queue = ${QUEUE} AND dedupe_key LIKE ${`${QUEUE}:${table}_%`}`
  await testSql().unsafe(`DROP TABLE IF EXISTS ${table}, ${table}_walk CASCADE`)
})

afterAll(async () => {
  await closeHarness()
  await dropOwnDatabase(own)
}, 180_000)

describe('the pass', () => {
  it('enqueues one row per missing index, each under its own key', async () => {
    const a = spec('a')
    const b = spec('b')
    __setDeferredIndexSpecsForTests([a, b])

    expect(await enqueueDeferredIndexBuilds()).toBe(2)
    expect(await enqueueDeferredIndexBuilds()).toBe(0)
    expect((await rowsOf(a.name)).map((r) => [r.dedupe_key, r.payload, r.max_attempts])).toEqual([
      [`${QUEUE}:${a.name}:1`, { index: a.name, gen: 1 }, 5],
    ])
    expect(await rowsOf(b.name)).toHaveLength(1)
  })

  it('is what the scheduled row runs', async () => {
    const a = spec('cron')
    __setDeferredIndexSpecsForTests([a])
    await runDeferredIndexJob(cronRow())
    expect(await rowsOf(a.name)).toHaveLength(1)
  })
})

describe('a build', () => {
  it('builds each missing index once, in one schedule cycle, and a second run does nothing', async () => {
    const a = spec('one')
    const b = spec('two')
    __setDeferredIndexSpecsForTests([a, b])
    onlyIndexQueue()

    await enqueueDeferredIndexBuilds()
    await drainAll()

    expect(await indexState(a.name)).toBe('valid')
    expect(await indexState(b.name)).toBe('valid')
    expect((await rowsOf(a.name)).map((r) => r.status)).toEqual(['succeeded'])

    const job = { ...cronRow(), payload: { index: a.name, gen: 1 } }
    const [{ oid: before }] = await testSql()<
      { oid: number }[]
    >`SELECT to_regclass(${a.name})::oid AS oid`
    await runDeferredIndexJob(job)
    const [{ oid: after }] = await testSql()<
      { oid: number }[]
    >`SELECT to_regclass(${a.name})::oid AS oid`
    expect(after).toBe(before)
    expect(await enqueueDeferredIndexBuilds()).toBe(0)
  })

  it('heals an invalid index by dropping and rebuilding it', async () => {
    await testSql().unsafe(`INSERT INTO ${table} (v) VALUES (1)`)
    const a = spec('heal', `${table} (v)`)
    // A killed concurrent build leaves an INVALID index under the spec's name.
    await testSql()
      .unsafe(`CREATE UNIQUE INDEX CONCURRENTLY ${a.name} ON ${table} (v)`)
      .catch(() => undefined)
    expect(await indexState(a.name)).toBe('invalid')
    __setDeferredIndexSpecsForTests([a])
    onlyIndexQueue()

    expect(await enqueueDeferredIndexBuilds()).toBe(1)
    await drainAll()

    expect(await indexState(a.name)).toBe('valid')
  })

  it('builds an index that failed once and then could be built', async () => {
    const later = `${table}_later`
    const a = spec('later', `${later} (v)`)
    __setDeferredIndexSpecsForTests([a])
    onlyIndexQueue()

    await enqueueDeferredIndexBuilds()
    expect((await drainOnce(CONFIG)).retrying).toBe(1)

    await testSql().unsafe(`CREATE TABLE ${later} (v int)`)
    try {
      await drainAll()
      expect(await indexState(a.name)).toBe('valid')
    } finally {
      await testSql().unsafe(`DROP TABLE IF EXISTS ${later}`)
    }
  })
})

describe('a build that keeps failing', () => {
  it('waits a day per round, stops after five rounds with one warning, and starts again after a restart', async () => {
    const a = spec('broken', `${table}_never (v)`)
    __setDeferredIndexSpecsForTests([a])

    expect(await enqueueDeferredIndexBuilds()).toBe(1)
    await failForGood(`${QUEUE}:${a.name}:1`)

    // Inside the cool-off: no new row.
    expect(await enqueueDeferredIndexBuilds()).toBe(0)

    for (let gen = 2; gen <= 5; gen++) {
      await ageTerminalRows(a.name)
      expect(await enqueueDeferredIndexBuilds()).toBe(1)
      await failForGood(`${QUEUE}:${a.name}:${gen}`)
    }
    // Counted by generation, not by rows: another suite's prune may already
    // have removed the aged terminal rows.
    expect(await currentGen(a.name)).toBe(5)

    // Five rounds: stopped, however old the last one is, with one warning.
    await ageTerminalRows(a.name)
    expect(await enqueueDeferredIndexBuilds()).toBe(0)
    expect(await enqueueDeferredIndexBuilds()).toBe(0)
    const warnings = logLines.filter((l) => l.level === 'warn' && l.fields.index === a.name)
    expect(warnings).toHaveLength(1)
    expect(await currentGen(a.name)).toBe(5)

    // A worker restart: the first pass of the new process tries once more.
    __resetDeferredIndexPassesForTests()
    expect(await enqueueDeferredIndexBuilds()).toBe(1)
    expect((await rowsOf(a.name)).map((r) => r.dedupe_key)).toContain(`${QUEUE}:${a.name}:6`)
    expect(await enqueueDeferredIndexBuilds()).toBe(0)
  })

  it('is not stopped by a row that succeeded while the index later went missing', async () => {
    const a = spec('dropped')
    __setDeferredIndexSpecsForTests([a])
    onlyIndexQueue()
    await enqueueDeferredIndexBuilds()
    await drainAll()
    expect(await indexState(a.name)).toBe('valid')

    await testSql().unsafe(`DROP INDEX ${a.name}`)
    await ageTerminalRows(a.name)
    expect(await enqueueDeferredIndexBuilds()).toBe(1)
  })
})

describe('the schedule gate', () => {
  it('stays open for a stopped build until the scheduled pass has warned about it', async () => {
    const a = spec('stop_sched', `${table}_never (v)`)
    __setDeferredIndexSpecsForTests([a])
    await enqueueDeferredIndexBuilds()
    await failForGood(`${QUEUE}:${a.name}:1`)
    for (let gen = 2; gen <= 5; gen++) {
      await ageTerminalRows(a.name)
      await enqueueDeferredIndexBuilds()
      await failForGood(`${QUEUE}:${a.name}:${gen}`)
    }
    await ageTerminalRows(a.name)
    onlyIndexQueue()

    const [first, second] = slotPair(35)
    const key = slotDedupeKey(QUEUE, second)
    try {
      expect(await deferredIndexBuildDue()).toBe(true)
      const state = createScheduleState()
      await runScheduleTick(state, first)
      expect((await runScheduleTick(state, second)).enqueued).toBe(1)
      await drainOnce(CONFIG)

      const warnings = logLines.filter((l) => l.level === 'warn' && l.fields.index === a.name)
      expect(warnings).toHaveLength(1)
      expect(await currentGen(a.name)).toBe(5)
      expect(await deferredIndexBuildDue()).toBe(false)
    } finally {
      await testSql()`DELETE FROM job_queue WHERE queue = ${QUEUE} AND dedupe_key = ${key}`
    }
  })

  it('writes the scheduled row through the real schedule, and that row enqueues the build', async () => {
    const a = spec('scheduled')
    __setDeferredIndexSpecsForTests([a])
    // Startup has made this process's first pass already.
    await enqueueDeferredIndexBuilds()
    await testSql()`DELETE FROM job_queue WHERE dedupe_key LIKE ${`${QUEUE}:${a.name}:%`}`
    await testSql()`DELETE FROM kv_store WHERE key LIKE ${`${QUEUE}:${a.name}:%`}`
    onlyIndexQueue()

    const [first, second] = slotPair(35)
    const key = slotDedupeKey(QUEUE, second)
    try {
      const state = createScheduleState()
      await runScheduleTick(state, first)
      expect((await runScheduleTick(state, second)).enqueued).toBe(1)
      await drainOnce(CONFIG)
      expect(await rowsOf(a.name)).toHaveLength(1)
      await drainAll()
      expect(await indexState(a.name)).toBe('valid')
    } finally {
      await testSql()`DELETE FROM job_queue WHERE queue = ${QUEUE} AND dedupe_key = ${key}`
    }
  })

  it('is shut with no background index, open while one is missing, and shut once built', async () => {
    __setDeferredIndexSpecsForTests([])
    expect(await deferredIndexBuildDue()).toBe(false)

    const a = spec('gate')
    __setDeferredIndexSpecsForTests([a])
    expect(await deferredIndexBuildDue()).toBe(true)

    onlyIndexQueue()
    await enqueueDeferredIndexBuilds()
    await drainAll()
    expect(await deferredIndexBuildDue()).toBe(false)
  })
})

describe('the upgrade work done line', () => {
  function doneLines() {
    return logLines.filter((l) => l.msg === 'upgrade work done')
  }

  it('is logged once when every backfill is done and every background index is built', async () => {
    const name = uniqueName('upgrade-done')
    // The backfill and its follow-up walk a table of their own.
    const walkTable = `${table}_walk`
    await createScratchTable(walkTable)
    const entry = sampleBackfill(name, { requiresMigration: TAG, table: walkTable })
    const a = spec('done')
    __setBackfillsForTests([entry])
    __setDeferredIndexSpecsForTests([a])
    await entry.fixture(testDb(), { ticketUpdatedAt: new Date('2025-01-01T00:00:00Z') })

    // Nothing done yet.
    expect(await noteUpgradeWorkDone()).toBe(false)
    await walkBackfill(entry)
    // The follow-up is still to run.
    expect(await noteUpgradeWorkDone()).toBe(false)
    await runBackfillFollowUpJob({
      ...cronRow(),
      queue: 'ticket-frt-reconcile',
      payload: { name, gen: 1 },
    })
    // One background index is still missing.
    expect(await noteUpgradeWorkDone()).toBe(false)
    expect(doneLines()).toHaveLength(0)

    onlyIndexQueue()
    await enqueueDeferredIndexBuilds()
    await drainAll()

    // The build that finished the work said so; nothing says it again.
    expect(doneLines()).toHaveLength(1)
    expect(await noteUpgradeWorkDone()).toBe(false)
    expect(doneLines()).toHaveLength(1)
    await testSql()`DELETE FROM kv_store WHERE key LIKE 'upgrade-done:%'`
  })
})
