/**
 * The runner: scheduling, draining, and the property the whole piece exists for
 * — a handler that runs far longer than any transaction should be held open.
 *
 * Real Postgres, real commits, unique queue names (the test database is shared
 * across every worktree on this machine).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupQueues,
  closeHarness,
  ensureJobQueueSchema,
  expireLease,
  rowsFor,
  testDb,
  testSql,
  uniqueQueue,
} from './harness'

vi.mock('@/lib/server/db', () => ({
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
}))

let currentTenantId: string | null = null
vi.mock('@/lib/server/tenancy/tenant-context', () => ({
  getCurrentTenant: () => (currentTenantId === null ? null : { tenantId: currentTenantId }),
}))

import { __setJobDefinitionsForTests } from '../definitions'
import { slotKey } from '../cron'
import { claimJobs, enqueueJob, reapExpiredLeases } from '../job-queue'
import {
  createScheduleState,
  drainOnce,
  resetJobHandlers,
  runJob,
  runMaintenanceTick,
  runScheduleTick,
  runnerConfig,
} from '../runner'

const created: string[] = []
function queue(label: string): string {
  const q = uniqueQueue(label)
  created.push(q)
  return q
}

const CONFIG = { ...runnerConfig(), batchSize: 10 }

beforeAll(async () => {
  await ensureJobQueueSchema()
})

afterEach(() => {
  currentTenantId = null
  __setJobDefinitionsForTests(null)
  resetJobHandlers()
})

afterAll(async () => {
  await cleanupQueues(created)
  await closeHarness()
})

describe('the schedule tick', () => {
  let state = createScheduleState()
  beforeEach(() => {
    state = createScheduleState()
  })

  it('enqueues the current slot once, however many times it ticks', async () => {
    const q = queue('sched')
    __setJobDefinitionsForTests([
      { name: q, cron: '* * * * *', handler: async () => async () => {} },
    ])

    // The first pass ADOPTS the slot in progress rather than running it, which
    // is what a repeatable job does on registration.
    const first = await runScheduleTick(state, new Date(2026, 7, 9, 14, 37, 12))
    expect(first.enqueued).toBe(0)
    expect(await rowsFor(q)).toHaveLength(0)

    // Same minute, a second later. Still the adopted slot, so nothing.
    const second = await runScheduleTick(state, new Date(2026, 7, 9, 14, 37, 55))
    expect(second.enqueued).toBe(0)
    expect(await rowsFor(q)).toHaveLength(0)

    // Next minute is a new slot, and it runs.
    const third = await runScheduleTick(state, new Date(2026, 7, 9, 14, 38, 1))
    expect(third.enqueued).toBe(1)
    // WHICH slot, not just how many. Counting alone cannot distinguish "this
    // slot" from "the next one" — an earlier version of this test passed with
    // the scheduler emitting the slot AFTER now, which would run every sweep a
    // full period late forever.
    expect((await rowsFor(q))[0].dedupe_key).toBe(slotKey(q, new Date(2026, 7, 9, 14, 38)))

    // And a fourth tick in the same minute adds nothing.
    expect((await runScheduleTick(state, new Date(2026, 7, 9, 14, 38, 30))).enqueued).toBe(0)
    expect(await rowsFor(q)).toHaveLength(1)
  })

  it('does not run a slot that passed before this process started', async () => {
    // The divergence this seed exists to prevent, stated as a test: a tier
    // booting at 14:00 must NOT immediately run the 03:00 daily sweep. Caught by
    // running the old and new builds side by side, not by reasoning.
    const q = queue('sched-boot')
    __setJobDefinitionsForTests([
      { name: q, cron: '0 3 * * *', handler: async () => async () => {} },
    ])
    const boot = await runScheduleTick(state, new Date(2026, 7, 9, 14, 0, 0))
    expect(boot.enqueued).toBe(0)
    expect(await rowsFor(q)).toHaveLength(0)

    // It runs at the next 03:00, and only then.
    expect((await runScheduleTick(state, new Date(2026, 7, 10, 2, 59, 0))).enqueued).toBe(0)
    expect((await runScheduleTick(state, new Date(2026, 7, 10, 3, 0, 5))).enqueued).toBe(1)
    expect((await rowsFor(q))[0].dedupe_key).toBe(slotKey(q, new Date(2026, 7, 10, 3, 0)))
  })

  it('reports the next slot so the loop can sleep to it instead of polling', async () => {
    const q = queue('sched-next')
    __setJobDefinitionsForTests([
      { name: q, cron: '*/5 * * * *', handler: async () => async () => {} },
    ])
    const tick = await runScheduleTick(state, new Date(2026, 7, 9, 14, 37, 0))
    expect(tick.nextSlotAt).toEqual(new Date(2026, 7, 9, 14, 40, 0))
  })

  it('does not backfill missed slots after an outage', async () => {
    // A tier down for three hours must run an hourly sweep ONCE on restart, not
    // three times — the behaviour the repeatable jobs had.
    const q = queue('sched-outage')
    __setJobDefinitionsForTests([
      { name: q, cron: '0 * * * *', handler: async () => async () => {} },
    ])
    await runScheduleTick(state, new Date(2026, 7, 9, 14, 5, 0)) // boot: adopt 14:00
    await runScheduleTick(state, new Date(2026, 7, 9, 17, 5, 0)) // three hours later
    const rows = await rowsFor(q)
    // ONE row, for the 17:00 slot — not a backfill of 15:00 and 16:00.
    expect(rows).toHaveLength(1)
    expect(rows[0].dedupe_key).toBe(slotKey(q, new Date(2026, 7, 9, 17, 0)))
    expect(rows[0].payload.scheduledFor).toBe(new Date(2026, 7, 9, 17, 0).toISOString())
  })

  it("gives every tenant every slot — one scheduler must not consume another's", async () => {
    // The defect this pins: a module-scope `seen` map keyed on the schedule name
    // alone is shared by every tenant loop in the process, so whichever tenant
    // reached a slot first advanced a counter the rest read as "already done".
    // Measured live on two Neon tenants before the fix: each minute's sweep
    // landed on exactly one tenant, never both.
    const q = queue('sched-two-tenants')
    __setJobDefinitionsForTests([
      { name: q, cron: '* * * * *', handler: async () => async () => {} },
    ])

    // Two schedulers, as `tier.ts` builds one per tenant loop.
    const alpha = createScheduleState()
    const bravo = createScheduleState()
    const minute = (m: number) => new Date(2026, 7, 9, 14, m, 5)

    // Both boot and adopt the slot in progress.
    await runScheduleTick(alpha, minute(0))
    await runScheduleTick(bravo, minute(0))

    // Then they interleave, which is what two independent loops do.
    const alphaKeys: string[] = []
    const bravoKeys: string[] = []
    for (const m of [1, 2, 3]) {
      // `attempted`, not `enqueued`: both schedulers share one test database, so
      // the second writer of each slot is legitimately deduped by the unique
      // index. Production gives each tenant its own database and both insert.
      // What must hold either way is that each scheduler DECIDED the slot was
      // due — which is exactly what shared state destroys.
      //
      // Asserted as an exact count rather than for truthiness. Reading it as a
      // boolean leaves the whole guard hanging on a counter nothing pins: an
      // `attempted` hardcoded to 1 passed this file, and passed it even with the
      // shared-state defect restored underneath.
      currentTenantId = 'tenant-alpha'
      const a = await runScheduleTick(alpha, minute(m))
      expect(a.attempted, `alpha attempted at minute ${m}`).toBe(1)
      alphaKeys.push(slotKey(q, new Date(2026, 7, 9, 14, m)))

      currentTenantId = 'tenant-bravo'
      const b = await runScheduleTick(bravo, minute(m))
      expect(b.attempted, `bravo attempted at minute ${m}`).toBe(1)
      bravoKeys.push(slotKey(q, new Date(2026, 7, 9, 14, m)))
    }

    // The other pole, and the reason the count is asserted at all: a tick with
    // no new slot due must attempt NOTHING. Without this, `attempted` could be
    // any always-truthy value and the guard above would still pass.
    currentTenantId = 'tenant-alpha'
    expect((await runScheduleTick(alpha, minute(3))).attempted).toBe(0)
    currentTenantId = 'tenant-bravo'
    expect((await runScheduleTick(bravo, minute(3))).attempted).toBe(0)
    currentTenantId = null

    // Each scheduler saw all three slots. With shared state the second caller of
    // each minute finds the counter already advanced and never attempts.
    const expected = [1, 2, 3].map((m) => slotKey(q, new Date(2026, 7, 9, 14, m)))
    expect(alphaKeys).toEqual(expected)
    expect(bravoKeys).toEqual(expected)

    // Only one row per slot survives here because both schedulers write to the
    // same test database; in production each tenant has its own. The rows prove
    // the enqueue was attempted for every slot by both.
    expect((await rowsFor(q)).map((r) => r.dedupe_key)).toEqual(expected)
  })

  it('carries the definition maxAttempts onto the enqueued row', async () => {
    const q = queue('sched-attempts')
    __setJobDefinitionsForTests([
      { name: q, cron: '* * * * *', maxAttempts: 3, handler: async () => async () => {} },
    ])
    await runScheduleTick(state, new Date(2026, 7, 9, 14, 37, 0))
    await runScheduleTick(state, new Date(2026, 7, 9, 14, 38, 0))
    expect((await rowsFor(q))[0].max_attempts).toBe(3)
  })
})

describe('draining', () => {
  it('runs the registered handler and records success', async () => {
    const q = queue('drain-ok')
    const seen: string[] = []
    __setJobDefinitionsForTests([
      {
        name: q,
        // Two jobs in one pass needs two slots. Per-queue concurrency is what
        // bounds a pass now (runner.ts's pool), so the default of 1 would claim
        // one job per call — the same shape its BullMQ Worker had.
        concurrency: 2,
        handler: async () => async (job) => {
          seen.push(String((job.payload as { n?: number }).n))
        },
      },
    ])
    await enqueueJob({ queue: q, payload: { n: 1 } })
    await enqueueJob({ queue: q, payload: { n: 2 } })

    const result = await drainOnce(CONFIG)
    expect(result.claimed).toBe(2)
    expect(result.succeeded).toBe(2)
    expect(seen.sort()).toEqual(['1', '2'])
    expect((await rowsFor(q)).every((r) => r.status === 'succeeded')).toBe(true)
  })

  it('records a throwing handler as failed, with the message', async () => {
    const q = queue('drain-throw')
    __setJobDefinitionsForTests([
      {
        name: q,
        maxAttempts: 1,
        handler: async () => async () => {
          throw new Error('handler exploded')
        },
      },
    ])
    await enqueueJob({ queue: q })

    const result = await drainOnce(CONFIG)
    expect(result.failed).toBe(1)
    const [row] = await rowsFor(q)
    expect(row.status).toBe('failed')
    expect(row.last_error).toMatch(/handler exploded/)
  })

  it('retries a throwing handler while attempts remain, then gives up', async () => {
    const q = queue('drain-retry')
    let calls = 0
    __setJobDefinitionsForTests([
      {
        name: q,
        maxAttempts: 2,
        retryBackoffMs: 0,
        handler: async () => async () => {
          calls += 1
          throw new Error('still broken')
        },
      },
    ])
    await enqueueJob({ queue: q, maxAttempts: 2 })

    expect((await drainOnce(CONFIG)).retrying).toBe(1)
    expect((await rowsFor(q))[0].status).toBe('pending')
    expect((await drainOnce(CONFIG)).failed).toBe(1)
    expect((await rowsFor(q))[0].status).toBe('failed')
    expect(calls).toBe(2)
    expect(await drainOnce(CONFIG)).toMatchObject({ claimed: 0 })
  })

  it('fails a job whose queue has no registered handler instead of losing it', async () => {
    // The shape a half-finished rename produces: a row exists for a queue name
    // the running definition list no longer knows. Losing it silently would be
    // worse than failing it, because nothing would ever surface the mismatch.
    const q = queue('drain-orphan')
    __setJobDefinitionsForTests([{ name: q, maxAttempts: 1, handler: async () => async () => {} }])
    await enqueueJob({ queue: q, maxAttempts: 1 })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: 30_000 }] })

    __setJobDefinitionsForTests([])
    expect(await runJob(job)).toBe('failed')

    const [row] = await rowsFor(q)
    expect(row.status).toBe('failed')
    expect(row.last_error).toMatch(/no handler registered/)
  })
})

describe('work that outlives a transaction', () => {
  it('holds a job through work longer than its initial lease, by heartbeat alone', async () => {
    const q = queue('long-work')
    // A 3s lease and 5s of work: without the heartbeat the reaper would take
    // this job away mid-flight. The heartbeat runs at a third of the lease.
    __setJobDefinitionsForTests([
      {
        name: q,
        leaseMs: 3_000,
        maxAttempts: 1,
        handler: async () => async () => {
          // Reap repeatedly *while the handler runs*. Nothing may take the job.
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 1_000))
            await reapExpiredLeases()
          }
        },
      },
    ])
    await enqueueJob({ queue: q, maxAttempts: 1 })

    const result = await drainOnce(CONFIG)
    expect(result.succeeded).toBe(1)

    const [row] = await rowsFor(q)
    expect(row.status).toBe('succeeded')
    // One attempt: the job was never handed to anybody else.
    expect(row.attempts).toBe(1)
  }, 30_000)
})

describe('maintenance', () => {
  it('reaps a stranded lease and prunes an aged terminal row in one pass', async () => {
    const q = queue('maintenance')
    __setJobDefinitionsForTests([{ name: q, maxAttempts: 1, handler: async () => async () => {} }])

    // A job a dead process left leased.
    await enqueueJob({ queue: q, dedupeKey: 'stranded', maxAttempts: 1 })
    await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: 30_000 }] })
    await expireLease(q)

    // And a terminal row older than any retention window.
    await enqueueJob({ queue: q, dedupeKey: 'ancient', maxAttempts: 1 })
    await testSql()`
      UPDATE job_queue SET status = 'succeeded', finished_at = now() - interval '400 days'
      WHERE queue = ${q} AND dedupe_key = 'ancient'
    `

    const result = await runMaintenanceTick(CONFIG)
    expect(result.terminated).toBeGreaterThanOrEqual(1)
    expect(result.pruned).toBeGreaterThanOrEqual(1)

    const rows = await rowsFor(q)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
    expect(rows[0].last_error).toMatch(/no attempts remaining/)
  })
})
