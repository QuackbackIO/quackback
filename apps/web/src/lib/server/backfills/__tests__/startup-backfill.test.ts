/**
 * The `startup-backfill` job and its follow-up.
 *
 * Startup and every schedule pass only enqueue: one deduped row per backfill,
 * never before the workspace has the backfill's migration. The job walks the
 * table in short transactions under a transaction-scoped try-lock, keeps its
 * cursor and its "done" marker in kv, and retries by failing. A row that fails
 * for good before "done" gets a new generation on the next pass, so the walk
 * never stops for good. The follow-up queue runs the step a backfill registers.
 *
 * Real Postgres, real commits, unique names. The ledger check is the one seam:
 * a test decides which migrations "this workspace" has applied.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeHarness, rowsFor } from '@/lib/server/jobs/__tests__/harness'

// The walks run over a scratch table in a schema of this suite's own, put first
// on the search path of every connection the harness opens. Other suites copy
// every table in `public`, and a table dropped there mid-copy breaks them.
const scratch = vi.hoisted(() => {
  const schema = `t_backfill_${process.pid}_${Date.now().toString(36)}`
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  )
  url.searchParams.set('search_path', `${schema},public`)
  process.env.DATABASE_URL = url.toString()
  return { schema }
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

/** The migrations "this workspace" has applied, by tag. */
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
import {
  BackfillBusyError,
  __setBackfillsForTests,
  enqueueBackfillPass,
  walkKeys,
  startupBackfillDue,
  walkBackfill,
  type BatchedBackfill,
} from '../batched'
import { runBackfillFollowUpJob } from '../follow-up-queue'
import { runStartupBackfillJob } from '../startup-backfill-queue'
import {
  cleanupBackfill,
  createScratchTable,
  flagCounts,
  followUpMarker,
  sampleBackfill,
  testDb,
  testSql,
  uniqueName,
  withOtherConnection,
} from './harness'

const TAG = '9999_sample_backfill_migration'
/** The walks here run over a table of their own, so batch boundaries are this suite's alone. */
const TABLE = 'walked_rows'
const CONFIG = { ...runnerConfig(), batchSize: 10 }
const ENV = 'QUACKBACK_DISABLED_JOBS'

const names: string[] = []
function backfill(
  label: string,
  opts: Omit<Parameters<typeof sampleBackfill>[1], 'requiresMigration'> = {}
): BatchedBackfill {
  const name = uniqueName(label)
  names.push(name)
  return sampleBackfill(name, { requiresMigration: TAG, table: TABLE, ...opts })
}

/** Seed the rows the backfill and its follow-up walk. */
async function seed(entry: BatchedBackfill): Promise<void> {
  const ctx = { ticketUpdatedAt: new Date('2025-01-01T00:00:00Z') }
  await entry.fixture(testDb(), ctx)
  await entry.followUp?.fixture(testDb(), ctx)
}

const walked = (entry: BatchedBackfill) => flagCounts(entry.name, 'walked', TABLE)
const reconciled = (entry: BatchedBackfill) =>
  flagCounts(followUpMarker(entry.name), 'reconciled', TABLE)

function jobDefinition(name: string) {
  const def = JOB_DEFINITIONS.find((d) => d.name === name)
  if (!def) throw new Error(`no job definition ${name}`)
  return def
}

/** Run only the queues this area adds, so a drain claims nothing else. */
function onlyBackfillQueues(): void {
  __setJobDefinitionsForTests([
    jobDefinition('startup-backfill'),
    jobDefinition('ticket-frt-reconcile'),
  ])
}

async function backfillRows(entry: BatchedBackfill) {
  return (await rowsFor('startup-backfill')).filter((r) =>
    r.dedupe_key?.startsWith(`backfill:${entry.name}:`)
  )
}

async function followUpRows(entry: BatchedBackfill) {
  return (await rowsFor('ticket-frt-reconcile')).filter((r) =>
    r.dedupe_key?.startsWith(`ticket-frt-reconcile:${entry.name}:`)
  )
}

async function kvValue(key: string): Promise<unknown> {
  const rows = await testSql()<{ value: unknown }[]>`
    SELECT value FROM kv_store WHERE key = ${key} AND expires_at > now()
  `
  return rows[0]?.value ?? null
}

/** Make a row's attempts spent and its status terminal, as a run of failures would. */
async function failForGood(dedupeKey: string): Promise<void> {
  await testSql()`
    UPDATE job_queue
    SET status = 'failed', attempts = max_attempts, finished_at = now(), locked_until = NULL,
        lease_token = NULL, locked_by = NULL
    WHERE dedupe_key = ${dedupeKey}
  `
}

/** Make a pending row due now, so a drain can claim it despite its backoff. */
async function dueNow(dedupeKey: string): Promise<void> {
  await testSql()`UPDATE job_queue SET run_at = now() WHERE dedupe_key = ${dedupeKey}`
}

function jobFor(payload: Record<string, unknown>, queue = 'startup-backfill'): ClaimedJob {
  return {
    id: '0',
    jobId: 'job_test',
    queue,
    dedupeKey: null,
    payload,
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 20,
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

beforeAll(async () => {
  await testSql().unsafe(`CREATE SCHEMA ${scratch.schema}`)
  await createScratchTable(TABLE)
})

beforeEach(async () => {
  ledger.applied = new Set([TAG])
  await testSql().unsafe(`TRUNCATE ${TABLE}`)
})

afterEach(async () => {
  // Rows a test left pending must not be claimed by the next test's drain. Each
  // test cleans up the names it made; earlier tests' names are gone already.
  for (const name of names.splice(0)) await cleanupBackfill(name)
  delete process.env[ENV]
  __setBackfillsForTests(null)
  __setJobDefinitionsForTests(null)
  resetJobHandlers()
  logLines.length = 0
})

afterAll(async () => {
  await testSql().unsafe(`DROP SCHEMA IF EXISTS ${scratch.schema} CASCADE`)
  await closeHarness()
})

describe('the enqueue pass (startup and every schedule pass)', () => {
  it('enqueues one row per backfill and walks nothing; a second pass enqueues none', async () => {
    const a = backfill('enqueue-a')
    const b = backfill('enqueue-b')
    __setBackfillsForTests([a, b])
    await seed(a)

    expect(await enqueueBackfillPass()).toBe(2)
    expect(await enqueueBackfillPass()).toBe(0)

    expect((await backfillRows(a)).map((r) => [r.dedupe_key, r.status, r.payload])).toEqual([
      [`backfill:${a.name}:1`, 'pending', { name: a.name, gen: 1 }],
    ])
    expect(await backfillRows(b)).toHaveLength(1)
    expect(await walked(a)).toEqual([0, 0, 0, 0, 0])
  })

  it('is what the scheduled row runs, so a workspace that slept through startup gets its row', async () => {
    const entry = backfill('scheduled')
    __setBackfillsForTests([entry])

    await runStartupBackfillJob(jobFor({ scheduledFor: new Date().toISOString() }))

    expect(await backfillRows(entry)).toHaveLength(1)
  })

  it('enqueues nothing for a workspace that lacks the migration, and does once it has it', async () => {
    const entry = backfill('ledger-gate')
    __setBackfillsForTests([entry])
    await seed(entry)
    onlyBackfillQueues()
    ledger.applied = new Set()

    expect(await enqueueBackfillPass()).toBe(0)
    expect(await backfillRows(entry)).toHaveLength(0)

    ledger.applied = new Set([TAG])
    expect(await enqueueBackfillPass()).toBe(1)
    await drainOnce(CONFIG)
    expect(await walked(entry)).toEqual([1, 1, 1, 1, 1])
  })

  it('enqueues nothing once the done marker is set', async () => {
    const entry = backfill('done', { followUp: false })
    __setBackfillsForTests([entry])
    await seed(entry)
    await walkBackfill(entry)

    expect(await kvValue(walkKeys(entry.name).done)).not.toBeNull()
    expect(await enqueueBackfillPass()).toBe(0)
    expect(await backfillRows(entry)).toHaveLength(0)
  })
})

describe('the walk', () => {
  it('commits each batch on its own, resumes from its cursor after a crash, and steps each row once', async () => {
    let crash = true
    let seenFromOutside: number[] | null = null
    const entry = backfill('resume', {
      followUp: false,
      walk: {
        batchSize: 2,
        onStep: async (batch) => {
          if (batch !== 2) return
          // The first batch is committed and visible to another connection
          // before the walk has finished.
          seenFromOutside ??= await withOtherConnection(async (other) =>
            (
              await other<{ n: number | null }[]>`
                SELECT (custom_attributes ->> 'walked')::int AS n FROM ${other(TABLE)}
                WHERE title LIKE ${`${entry.name}-%`} ORDER BY id
              `
            ).map((r) => r.n ?? 0)
          )
          if (crash) {
            crash = false
            throw new Error('worker killed mid-walk')
          }
        },
      },
    })
    __setBackfillsForTests([entry])
    await seed(entry)

    await expect(walkBackfill(entry)).rejects.toThrow('worker killed mid-walk')
    expect(seenFromOutside).toEqual([1, 1, 0, 0, 0])
    expect(await kvValue(walkKeys(entry.name).cursor)).not.toBeNull()
    expect(await kvValue(walkKeys(entry.name).done)).toBeNull()

    await walkBackfill(entry)
    expect(await walked(entry)).toEqual([1, 1, 1, 1, 1])
    expect(await kvValue(walkKeys(entry.name).done)).not.toBeNull()
  })

  it('throws, committing nothing, when another runner holds the backfill lock', async () => {
    const entry = backfill('busy', { followUp: false })
    __setBackfillsForTests([entry])
    await seed(entry)

    await withOtherConnection(async (other) => {
      await other.unsafe('BEGIN')
      await other`SELECT pg_advisory_xact_lock(hashtext(${`quackback:backfill:${entry.name}`}))`
      try {
        await expect(walkBackfill(entry)).rejects.toBeInstanceOf(BackfillBusyError)
      } finally {
        await other.unsafe('ROLLBACK')
      }
    })
    expect(await walked(entry)).toEqual([0, 0, 0, 0, 0])
    expect(await kvValue(walkKeys(entry.name).cursor)).toBeNull()
  })

  it('returns at once for a walk already done, without a batch transaction', async () => {
    const entry = backfill('done-walk', { followUp: false })
    __setBackfillsForTests([entry])
    await seed(entry)
    await walkBackfill(entry)

    // Another runner holds the lock: a batch would throw BackfillBusyError.
    await withOtherConnection(async (other) => {
      await other.unsafe('BEGIN')
      await other`SELECT pg_advisory_xact_lock(hashtext(${`quackback:backfill:${entry.name}`}))`
      try {
        await expect(walkBackfill(entry)).resolves.toBeUndefined()
      } finally {
        await other.unsafe('ROLLBACK')
      }
    })
    expect(await walked(entry)).toEqual([1, 1, 1, 1, 1])
  })

  it('holds no lock after a batch fails', async () => {
    const entry = backfill('no-lock', {
      followUp: false,
      walk: {
        onStep: () => {
          throw new Error('batch failed')
        },
      },
    })
    __setBackfillsForTests([entry])
    await seed(entry)

    await expect(walkBackfill(entry)).rejects.toThrow('batch failed')

    const held = await testSql()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory'
        AND ((classid::bigint << 32) | objid::bigint)
          = hashtext(${`quackback:backfill:${entry.name}`})::bigint
    `
    expect(held[0].n).toBe(0)
  })

  it('throws when the workspace lacks the migration, so the queue retries it', async () => {
    const entry = backfill('floor-miss', { followUp: false })
    __setBackfillsForTests([entry])
    await seed(entry)
    ledger.applied = new Set()

    await expect(walkBackfill(entry)).rejects.toThrow(TAG)
    expect(await walked(entry)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('retries and generations', () => {
  it('puts a failed batch back to pending on the same row, later, with one more attempt', async () => {
    let fail = true
    const entry = backfill('retry', {
      followUp: false,
      walk: {
        onStep: () => {
          if (fail) throw new Error('database restarted')
        },
      },
    })
    __setBackfillsForTests([entry])
    await seed(entry)
    onlyBackfillQueues()
    await enqueueBackfillPass()

    const before = Date.now()
    const first = await drainOnce(CONFIG)
    expect(first.retrying).toBe(1)
    const [row] = await backfillRows(entry)
    expect(await backfillRows(entry)).toHaveLength(1)
    expect(row).toMatchObject({ status: 'pending', attempts: 1, max_attempts: 20 })
    expect(row.run_at.getTime()).toBeGreaterThan(before)

    fail = false
    await dueNow(row.dedupe_key!)
    await drainOnce(CONFIG)
    expect((await backfillRows(entry)).map((r) => [r.status, r.attempts])).toEqual([
      ['succeeded', 2],
    ])
    expect(await walked(entry)).toEqual([1, 1, 1, 1, 1])
  })

  it('enqueues a new generation after a row fails for good, and the walk then finishes', async () => {
    const entry = backfill('new-gen', { followUp: false })
    __setBackfillsForTests([entry])
    await seed(entry)
    onlyBackfillQueues()
    // A row enqueued before the migration landed, which kept missing it.
    await enqueueBackfillPass()
    ledger.applied = new Set()
    await failForGood(`backfill:${entry.name}:1`)

    // Still no migration: nothing new.
    expect(await enqueueBackfillPass()).toBe(0)

    ledger.applied = new Set([TAG])
    expect(await enqueueBackfillPass()).toBe(1)
    expect(await enqueueBackfillPass()).toBe(0)
    expect((await backfillRows(entry)).map((r) => [r.dedupe_key, r.status])).toEqual([
      [`backfill:${entry.name}:1`, 'failed'],
      [`backfill:${entry.name}:2`, 'pending'],
    ])
    expect(await kvValue(walkKeys(entry.name).gen)).toBe(2)

    await drainOnce(CONFIG)
    expect(await walked(entry)).toEqual([1, 1, 1, 1, 1])
    expect(await enqueueBackfillPass()).toBe(0)
  })

  it('puts a row that meets a missing migration back to pending with backoff', async () => {
    const entry = backfill('floor-retry', { followUp: false })
    __setBackfillsForTests([entry])
    await seed(entry)
    onlyBackfillQueues()
    await enqueueBackfillPass()
    ledger.applied = new Set()

    const result = await drainOnce(CONFIG)
    expect(result.retrying).toBe(1)
    expect((await backfillRows(entry))[0]).toMatchObject({ status: 'pending', attempts: 1 })
  })

  it('keeps a paused row pending, and walks once the pause is lifted', async () => {
    const entry = backfill('paused', { followUp: false })
    __setBackfillsForTests([entry])
    await seed(entry)
    onlyBackfillQueues()
    await enqueueBackfillPass()

    process.env[ENV] = 'startup-backfill'
    expect((await drainOnce(CONFIG)).claimed).toBe(0)
    expect((await backfillRows(entry))[0]).toMatchObject({ status: 'pending', attempts: 0 })

    delete process.env[ENV]
    await drainOnce(CONFIG)
    expect(await walked(entry)).toEqual([1, 1, 1, 1, 1])
  })
})

describe('the follow-up', () => {
  it('is enqueued once, delayed, when the walk finishes; a rerun enqueues none', async () => {
    const delayMs = 45 * 60_000
    const entry = backfill('follow-enqueue', { delayMs })
    __setBackfillsForTests([entry])
    await seed(entry)

    const before = Date.now()
    await walkBackfill(entry)
    await walkBackfill(entry)

    const rows = await followUpRows(entry)
    expect(rows.map((r) => [r.dedupe_key, r.status, r.payload, r.max_attempts])).toEqual([
      [`ticket-frt-reconcile:${entry.name}:1`, 'pending', { name: entry.name, gen: 1 }, 20],
    ])
    expect(rows[0].run_at.getTime()).toBeGreaterThanOrEqual(before + delayMs - 1_000)
    expect(rows[0].run_at.getTime()).toBeLessThanOrEqual(Date.now() + delayMs + 1_000)
  })

  it('runs the step the backfill registers', async () => {
    const entry = backfill('follow-run')
    __setBackfillsForTests([entry])
    await seed(entry)
    await walkBackfill(entry)

    await runBackfillFollowUpJob(jobFor({ name: entry.name, gen: 1 }, 'ticket-frt-reconcile'))

    expect(await reconciled(entry)).toEqual([1, 1, 1, 1, 1])
    expect(await kvValue(walkKeys(entry.name, 'follow-up').done)).not.toBeNull()
  })

  it('fails and retries a job for a backfill with no registered step', async () => {
    const entry = backfill('follow-missing', { followUp: false })
    __setBackfillsForTests([entry])
    await expect(
      runBackfillFollowUpJob(jobFor({ name: entry.name, gen: 1 }, 'ticket-frt-reconcile'))
    ).rejects.toThrow(/no follow-up step/)

    onlyBackfillQueues()
    await testSql()`
      INSERT INTO job_queue (job_id, queue, dedupe_key, payload, max_attempts)
      VALUES (${`job_${entry.name}`}, 'ticket-frt-reconcile', ${`ticket-frt-reconcile:${entry.name}:1`},
              ${JSON.stringify({ name: entry.name, gen: 1 })}::jsonb, 20)
    `
    const before = Date.now()
    expect((await drainOnce(CONFIG)).retrying).toBe(1)
    const [row] = await followUpRows(entry)
    expect(row).toMatchObject({ status: 'pending', attempts: 1 })
    expect(row.run_at.getTime()).toBeGreaterThan(before)
  })

  it('gets its own new generation after it fails for good, and is not enqueued before its migration', async () => {
    const entry = backfill('follow-gen')
    __setBackfillsForTests([entry])
    await seed(entry)
    onlyBackfillQueues()
    await walkBackfill(entry)
    await failForGood(`ticket-frt-reconcile:${entry.name}:1`)

    ledger.applied = new Set()
    expect(await enqueueBackfillPass()).toBe(0)

    ledger.applied = new Set([TAG])
    expect(await enqueueBackfillPass()).toBe(1)
    expect((await followUpRows(entry)).map((r) => [r.dedupe_key, r.status])).toEqual([
      [`ticket-frt-reconcile:${entry.name}:1`, 'failed'],
      [`ticket-frt-reconcile:${entry.name}:2`, 'pending'],
    ])
    expect(await kvValue(walkKeys(entry.name, 'follow-up').gen)).toBe(2)
    // The backfill's own generation is untouched.
    expect(await backfillRows(entry)).toHaveLength(0)

    await drainOnce(CONFIG)
    expect(await reconciled(entry)).toEqual([1, 1, 1, 1, 1])
    expect(await enqueueBackfillPass()).toBe(0)
  })

  it('throws when the workspace lacks the migration', async () => {
    const entry = backfill('follow-floor')
    __setBackfillsForTests([entry])
    await seed(entry)
    await walkBackfill(entry)
    ledger.applied = new Set()

    await expect(
      runBackfillFollowUpJob(jobFor({ name: entry.name, gen: 1 }, 'ticket-frt-reconcile'))
    ).rejects.toThrow(TAG)
    expect(await reconciled(entry)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('the schedule gate', () => {
  it('writes the scheduled row through the real schedule, and that row enqueues and walks', async () => {
    const entry = backfill('through-schedule', { followUp: false })
    __setBackfillsForTests([entry])
    await seed(entry)
    onlyBackfillQueues()
    const [first, second] = slotPair(15)
    const key = slotDedupeKey('startup-backfill', second)
    try {
      // A loop that wakes adopts the slot it starts in and runs the next one.
      const state = createScheduleState()
      expect((await runScheduleTick(state, first)).enqueued).toBe(0)
      expect((await runScheduleTick(state, second)).enqueued).toBe(1)

      await drainOnce(CONFIG)
      expect(await backfillRows(entry)).toHaveLength(1)
      await drainOnce(CONFIG)
      expect(await walked(entry)).toEqual([1, 1, 1, 1, 1])
    } finally {
      await testSql()`DELETE FROM job_queue WHERE queue = 'startup-backfill' AND dedupe_key = ${key}`
    }
  })

  it('is shut with nothing registered, open while work remains, and shut once all is done', async () => {
    __setBackfillsForTests([])
    expect(await startupBackfillDue()).toBe(false)

    const entry = backfill('gate')
    __setBackfillsForTests([entry])
    await seed(entry)
    expect(await startupBackfillDue()).toBe(true)

    await walkBackfill(entry)
    expect(await startupBackfillDue()).toBe(true)
    await runBackfillFollowUpJob(jobFor({ name: entry.name, gen: 1 }, 'ticket-frt-reconcile'))
    expect(await startupBackfillDue()).toBe(false)
  })
})

describe('locks', () => {
  it('takes no session-level advisory lock anywhere under lib/server/backfills', () => {
    const dir = path.resolve(__dirname, '..')
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    expect(sources.length).toBeGreaterThan(0)
    for (const file of sources) {
      const text = readFileSync(path.join(dir, file), 'utf8')
      expect(text, file).not.toMatch(/pg_(try_)?advisory_lock(_shared)?\s*\(/)
    }
  })

  it('walks under the transaction-scoped try-lock', () => {
    const text = readFileSync(path.resolve(__dirname, '../batched.ts'), 'utf8')
    expect(text).toMatch(/pg_try_advisory_xact_lock\(/)
  })
})
