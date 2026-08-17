/**
 * The lease primitive, against a real Postgres.
 *
 * These properties do not survive being mocked. `FOR UPDATE SKIP LOCKED`, the
 * `attempts < max_attempts` predicate, the fencing token and the CHECK
 * constraint on lease shape are all *database* behaviour; a test double would
 * assert that the strings I wrote are the strings I wrote.
 *
 * The suite is scoped to unique queue names because `DATABASE_URL` points every
 * worktree on this machine at one shared `quackback_test`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

// The primitive resolves `db` through the app's proxy; point it at the
// harness's own committing connection. Lazily, via a proxy of the same shape as
// the real one: `vi.mock` factories run during the module graph's construction,
// which is too early to have built a connection.
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

// The workspace assertion reads the ambient scope. A settable stub lets a test
// stand a row's stamp and the scope's identity against each other, which is the
// only way to exercise the refusal.
let currentWorkspaceKey: string | null = null
vi.mock('@/lib/server/workspaces/workspace-context', () => ({
  getCurrentWorkspace: () =>
    currentWorkspaceKey === null ? null : { workspaceKey: currentWorkspaceKey },
}))

const nudgeWorker = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/workspaces/wake-nudge', () => ({
  nudgeWorker: (...a: unknown[]) => nudgeWorker(...a),
}))

import {
  cancelJob,
  claimJobs,
  completeJob,
  enqueueJob,
  enqueueJobs,
  failJob,
  findJobByDedupeKey,
  heartbeatJob,
  jobQueueDepth,
  pruneTerminalJobs,
  reapExpiredLeases,
  type ClaimedJob,
} from '../job-queue'

const created: string[] = []
function queue(label: string): string {
  const q = uniqueQueue(label)
  created.push(q)
  return q
}

beforeAll(async () => {
  await ensureJobQueueSchema()
})

afterEach(() => {
  currentWorkspaceKey = null
  nudgeWorker.mockClear()
})

afterAll(async () => {
  await cleanupQueues(created)
  await closeHarness()
})

const LEASE = 30_000

describe('enqueue', () => {
  it('writes a runnable row', async () => {
    const q = queue('enqueue')
    currentWorkspaceKey = 'ws_enqueue'
    const { jobId, inserted } = await enqueueJob({ queue: q, payload: { hello: 'world' } })
    expect(inserted).toBe(true)
    expect(jobId).toMatch(/^job_/)
    expect(nudgeWorker).toHaveBeenCalledWith('ws_enqueue')

    const rows = await rowsFor(q)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].attempts).toBe(0)
    expect(rows[0].max_attempts).toBe(1)
    expect(rows[0].lease_token).toBeNull()
  })

  it('is idempotent on a dedupe key, including after the first row went terminal', async () => {
    const q = queue('dedupe')
    const first = await enqueueJob({ queue: q, dedupeKey: 'slot-1' })
    expect(first.inserted).toBe(true)

    const second = await enqueueJob({ queue: q, dedupeKey: 'slot-1' })
    expect(second.inserted).toBe(false)
    expect(await rowsFor(q)).toHaveLength(1)

    // Run it to completion, then try the same key again. A spent cron slot must
    // stay spent — otherwise a scheduler restart re-runs the slot it already ran.
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    await completeJob(job)
    const third = await enqueueJob({ queue: q, dedupeKey: 'slot-1' })
    expect(third.inserted).toBe(false)
    expect(await rowsFor(q)).toHaveLength(1)
  })

  it('rejects a maxAttempts below one rather than coercing it', async () => {
    const q = queue('bad-attempts')
    await expect(enqueueJob({ queue: q, maxAttempts: 0 })).rejects.toThrow(/maxAttempts/)
  })
})

describe('claim', () => {
  it('increments attempts and stamps the lease, in one short transaction', async () => {
    const q = queue('claim')
    await enqueueJob({ queue: q })

    const before = Date.now()
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] })
    expect(job).toBeDefined()
    expect(job.attempts).toBe(1)

    const [row] = await rowsFor(q)
    expect(row.status).toBe('running')
    // attempts is incremented BY THE CLAIM. This is the whole at-most-once
    // property; if this reads 0 the reaper will hand a no-retry job back.
    expect(row.attempts).toBe(1)
    expect(row.lease_token).not.toBeNull()
    expect(row.locked_by).not.toBeNull()
    expect(row.locked_until!.getTime()).toBeGreaterThan(before)
  })

  it('does not claim a job whose run_at is in the future', async () => {
    const q = queue('delayed')
    await enqueueJob({ queue: q, runAt: new Date(Date.now() + 60_000) })
    expect(await claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] })).toHaveLength(0)
  })

  it('skips a row another claimer is holding rather than blocking behind it', async () => {
    // Deterministic, unlike racing two claims: a first attempt at this test
    // asserted that two concurrent claims yielded one job, and it passed with
    // SKIP LOCKED deleted — the two statements simply serialised, so the
    // contended path was never reached. Holding the row from a second
    // connection forces contention instead of hoping for it.
    const q = queue('skip-locked')
    await enqueueJob({ queue: q })

    const holder = testSql()
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const holding = holder
      .begin(async (tx) => {
        await tx`SELECT id FROM job_queue WHERE queue = ${q} FOR UPDATE`
        await held
      })
      .catch(() => {})

    // Let the holder actually take the lock before claiming.
    await new Promise((r) => setTimeout(r, 150))

    const BLOCKED = Symbol('blocked')
    const raced = await Promise.race([
      claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] }),
      new Promise<typeof BLOCKED>((r) => setTimeout(() => r(BLOCKED), 2_000)),
    ])
    release()
    await holding

    // SKIP LOCKED means "return nothing, now". Without it the claim waits on
    // the lock and this reads BLOCKED.
    expect(raced).not.toBe(BLOCKED)
    expect(raced).toHaveLength(0)

    // The row is untouched: not claimed, and not counted as an attempt.
    const [row] = await rowsFor(q)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(0)
  })

  it('hands one job to exactly one of two concurrent claimers', async () => {
    const q = queue('one-claimer')
    await enqueueJob({ queue: q })

    const [a, b] = await Promise.all([
      claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] }),
      claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] }),
    ])
    expect(a.length + b.length).toBe(1)

    const [row] = await rowsFor(q)
    expect(row.attempts).toBe(1)
  })

  it('refuses a pending row that is already out of attempts', async () => {
    // The second barrier. Nothing in this module produces this state, which is
    // exactly why it is worth pinning: if some future writer resets a spent job
    // to pending, at-most-once must still hold.
    const q = queue('spent-pending')
    await enqueueJob({ queue: q, maxAttempts: 1 })
    await testSql()`UPDATE job_queue SET attempts = 1 WHERE queue = ${q}`

    expect(await claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] })).toHaveLength(0)
  })
})

describe('holding work longer than a transaction', () => {
  it('leaves no row lock behind, so the claim cannot be a long transaction', async () => {
    const q = queue('no-row-lock')
    await enqueueJob({ queue: q })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    expect(job).toBeDefined()

    // If the claim were holding the row (the naive `FOR UPDATE` shape), this
    // would raise 55P03 lock_not_available. It succeeds, which is the evidence
    // that the lease — not a transaction — is what holds the job.
    const other = testSql()
    const locked = await other.begin(async (tx) => {
      const rows = await tx`
        SELECT id FROM job_queue WHERE queue = ${q} FOR UPDATE NOWAIT
      `
      return rows.length
    })
    expect(locked).toBe(1)

    // And the job is still leased to us while that is true.
    const [row] = await rowsFor(q)
    expect(row.status).toBe('running')
    expect(row.locked_until!.getTime()).toBeGreaterThan(Date.now())
  })

  it('extends the lease by heartbeat, with no transaction open', async () => {
    const q = queue('heartbeat')
    await enqueueJob({ queue: q })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: 2_000 }] })
    const [before] = await rowsFor(q)

    const held = await heartbeatJob(job, 120_000)
    expect(held).toBe(true)

    const [after] = await rowsFor(q)
    expect(after.locked_until!.getTime()).toBeGreaterThan(before.locked_until!.getTime())
    // A 120s lease is longer than any transaction should ever be held open, and
    // this one is held by a timestamp instead.
    expect(after.locked_until!.getTime() - Date.now()).toBeGreaterThan(100_000)
  })
})

describe('the reaper and the no-retry flag', () => {
  it('terminates an expired lease on a no-retry job instead of requeueing it', async () => {
    const q = queue('no-retry')
    await enqueueJob({ queue: q, maxAttempts: 1 })
    await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    await expireLease(q)

    const reaped = await reapExpiredLeases()
    expect(reaped.terminated).toBeGreaterThanOrEqual(1)

    const [row] = await rowsFor(q)
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(1)
    expect(row.last_error).toMatch(/no attempts remaining/)
    expect(row.finished_at).not.toBeNull()

    // And it stays unclaimable. A terminal row is not pending, and even if it
    // were, `attempts < max_attempts` refuses it.
    expect(await claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] })).toHaveLength(0)
  })

  it('requeues an expired lease while attempts remain, then terminates on the last', async () => {
    const q = queue('retryable')
    await enqueueJob({ queue: q, maxAttempts: 3 })

    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
      expect(claimed).toHaveLength(1)
      expect(claimed[0].attempts).toBe(attempt)
      await expireLease(q)
      const reaped = await reapExpiredLeases()
      if (attempt < 3) {
        expect(reaped.requeued).toBeGreaterThanOrEqual(1)
        expect((await rowsFor(q))[0].status).toBe('pending')
      } else {
        expect(reaped.terminated).toBeGreaterThanOrEqual(1)
        expect((await rowsFor(q))[0].status).toBe('failed')
      }
    }

    expect(await claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] })).toHaveLength(0)
  })

  it('leaves an unexpired lease alone', async () => {
    const q = queue('live-lease')
    await enqueueJob({ queue: q, maxAttempts: 3 })
    await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })

    await reapExpiredLeases()
    expect((await rowsFor(q))[0].status).toBe('running')
  })
})

describe('the fencing token', () => {
  it('stops a reaped owner from recording a result over its successor', async () => {
    const q = queue('fencing')
    await enqueueJob({ queue: q, maxAttempts: 3 })
    const [ghost] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })

    // The ghost stalls; the reaper decides it is dead and hands the job back.
    await expireLease(q)
    await reapExpiredLeases()
    const [heir] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    expect(heir.leaseToken).not.toBe(ghost.leaseToken)

    // The ghost comes back and reports success. It must not be believed.
    expect(await completeJob(ghost)).toBe(false)
    expect(await heartbeatJob(ghost, LEASE)).toBe(false)
    expect(await failJob(ghost, 'ghost failure')).toBe('lease-lost')

    const [row] = await rowsFor(q)
    expect(row.status).toBe('running')
    expect(row.lease_token).toBe(heir.leaseToken)
    // The reaper's own note survives; the ghost's does not overwrite it.
    expect(row.last_error).toMatch(/lease expired; requeued/)
    expect(row.last_error).not.toMatch(/ghost failure/)

    // The heir's own write is accepted.
    expect(await completeJob(heir)).toBe(true)
    expect((await rowsFor(q))[0].status).toBe('succeeded')
  })
})

describe('the workspace assertion', () => {
  it('stamps the enqueueing workspace and accepts a matching claim', async () => {
    const q = queue('workspace-match')
    currentWorkspaceKey = 'inst_alpha'
    await enqueueJob({ queue: q })
    expect((await rowsFor(q))[0].workspace_key).toBe('inst_alpha')

    const claimed = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    expect(claimed).toHaveLength(1)
    expect(claimed[0].workspaceKey).toBe('inst_alpha')
  })

  it('refuses a row stamped for another workspace, terminally, without returning it', async () => {
    const q = queue('workspace-mismatch')
    currentWorkspaceKey = 'inst_alpha'
    await enqueueJob({ queue: q })

    // The row is now in THIS database claiming to belong to somebody else — the
    // shape a mis-routed write or a restored dump produces. Running it would be
    // a cross-workspace execution.
    await testSql()`UPDATE job_queue SET workspace_key = 'inst_bravo' WHERE queue = ${q}`

    const claimed = await claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] })
    expect(claimed).toHaveLength(0)

    const [row] = await rowsFor(q)
    expect(row.status).toBe('failed')
    expect(row.last_error).toMatch(/workspace mismatch/)
    // It stays refused rather than becoming claimable on the next pass.
    expect(await claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] })).toHaveLength(0)
  })

  it('refuses a workspace-stamped row when no workspace scope is open', async () => {
    const q = queue('workspace-unscoped')
    currentWorkspaceKey = 'inst_alpha'
    await enqueueJob({ queue: q })

    currentWorkspaceKey = null
    expect(await claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] })).toHaveLength(0)
    expect((await rowsFor(q))[0].status).toBe('failed')
  })
})

describe('failure reporting', () => {
  it('retries with backoff while attempts remain', async () => {
    const q = queue('fail-retry')
    await enqueueJob({ queue: q, maxAttempts: 2 })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })

    expect(await failJob(job, 'boom', { backoffMs: 30_000 })).toBe('retrying')
    const [row] = await rowsFor(q)
    expect(row.status).toBe('pending')
    expect(row.last_error).toBe('boom')
    expect(row.run_at.getTime()).toBeGreaterThan(Date.now() + 20_000)
    // Backed off, so not claimable yet.
    expect(await claimJobs({ specs: [{ queue: q, limit: 5, leaseMs: LEASE }] })).toHaveLength(0)
  })

  it('goes terminal on the last attempt', async () => {
    const q = queue('fail-final')
    await enqueueJob({ queue: q, maxAttempts: 1 })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })

    expect(await failJob(job, 'boom')).toBe('failed')
    const [row] = await rowsFor(q)
    expect(row.status).toBe('failed')
    expect(row.finished_at).not.toBeNull()
  })
})

describe('retention', () => {
  it('drops terminal rows past the window and keeps live ones', async () => {
    const q = queue('retention')
    await enqueueJob({ queue: q, dedupeKey: 'old' })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    await completeJob(job)
    await enqueueJob({ queue: q, dedupeKey: 'live' })

    await testSql()`
      UPDATE job_queue SET finished_at = now() - interval '30 days'
      WHERE queue = ${q} AND status = 'succeeded'
    `
    await pruneTerminalJobs(7 * 24 * 60 * 60 * 1000)

    const rows = await rowsFor(q)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
  })
})

describe('depth reporting', () => {
  it('reports counts by status', async () => {
    const q = queue('depth')
    await enqueueJob({ queue: q })
    const depth = await jobQueueDepth()
    // Shared database: assert this queue contributed, not the whole table.
    expect(depth.pending ?? 0).toBeGreaterThanOrEqual(1)
  })
})

describe('the lease-shape constraint', () => {
  it('refuses a running row with no lease at the database level', async () => {
    const q = queue('shape')
    await enqueueJob({ queue: q })
    await expect(
      testSql()`UPDATE job_queue SET status = 'running' WHERE queue = ${q}`
    ).rejects.toThrow(/job_queue_lease_shape_check/)
  })

  it('refuses a pending row that still carries a lease', async () => {
    const q = queue('shape-2')
    await enqueueJob({ queue: q })
    const claimed: ClaimedJob[] = await claimJobs({
      specs: [{ queue: q, limit: 1, leaseMs: LEASE }],
    })
    expect(claimed).toHaveLength(1)
    await expect(
      testSql()`UPDATE job_queue SET status = 'pending' WHERE queue = ${q}`
    ).rejects.toThrow(/job_queue_lease_shape_check/)
  })
})

describe('what a claimed row carries', () => {
  it('hands the handler its dedupe key', async () => {
    // Not decoration: for a relay-enqueued hook this key IS the deterministic
    // `<eventId>:<sink>:<target>` id the reference passed into `hook.run` as
    // `job.id`, and handlers dedupe their own side effects on it. A test that
    // builds a ClaimedJob by hand cannot see this mapping break.
    const q = queue('claim-dedupe-key')
    await enqueueJob({ queue: q, dedupeKey: 'evt-1:webhook:abc' })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    expect(job.dedupeKey).toBe('evt-1:webhook:abc')
  })

  it('reports a null dedupe key for a row that has none', async () => {
    const q = queue('claim-no-dedupe-key')
    await enqueueJob({ queue: q })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    expect(job.dedupeKey).toBeNull()
  })
})

describe('the per-queue claim cap', () => {
  it('takes at most each queue’s own limit, in one pass', async () => {
    // The reference gave each queue its own Worker with its own concurrency.
    // A single LIMIT over a union of queues loses that: one queue's backlog
    // fills the batch and the others starve.
    const busy = queue('cap-busy')
    const quiet = queue('cap-quiet')
    for (let i = 0; i < 5; i++) await enqueueJob({ queue: busy, dedupeKey: `b${i}` })
    for (let i = 0; i < 5; i++) await enqueueJob({ queue: quiet, dedupeKey: `q${i}` })

    const claimed = await claimJobs({
      specs: [
        { queue: busy, limit: 1, leaseMs: LEASE },
        { queue: quiet, limit: 3, leaseMs: LEASE },
      ],
    })
    const byQueue = new Map<string, number>()
    for (const job of claimed) byQueue.set(job.queue, (byQueue.get(job.queue) ?? 0) + 1)
    expect(byQueue.get(busy)).toBe(1)
    expect(byQueue.get(quiet)).toBe(3)
  })

  it('leases each queue’s rows for that queue’s own lease, not the batch’s longest', async () => {
    // `help-center-translate` needs 120s. Applying that to a `snooze-sweep` row
    // that happened to be claimed alongside it would make a dead worker's sweep
    // unavailable for two minutes.
    const slow = queue('lease-slow')
    const fast = queue('lease-fast')
    await enqueueJob({ queue: slow })
    await enqueueJob({ queue: fast })

    const before = Date.now()
    const claimed = await claimJobs({
      specs: [
        { queue: slow, limit: 1, leaseMs: 120_000 },
        { queue: fast, limit: 1, leaseMs: 10_000 },
      ],
    })
    expect(claimed).toHaveLength(2)
    const held = (name: string) =>
      claimed.find((j) => j.queue === name)!.lockedUntil.getTime() - before
    expect(held(slow)).toBeGreaterThan(100_000)
    expect(held(fast)).toBeLessThan(30_000)
  })

  it('asks for nothing when every queue is at capacity', async () => {
    const q = queue('cap-zero')
    await enqueueJob({ queue: q })
    expect(await claimJobs({ specs: [{ queue: q, limit: 0, leaseMs: LEASE }] })).toHaveLength(0)
    expect((await rowsFor(q))[0].status).toBe('pending')
  })
})

describe('terminal failure', () => {
  it('fails a job outright even with attempts remaining', async () => {
    const q = queue('terminal')
    await enqueueJob({ queue: q, maxAttempts: 3 })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    expect(await failJob(job, 'unknown hook', { terminal: true })).toBe('failed')
    const [row] = await rowsFor(q)
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(1)
    expect(row.max_attempts).toBe(3)
  })

  it('cannot make a spent job retryable', async () => {
    // The flag is ANDed into the retry predicate, never substituted for it, so
    // there is no value of `terminal` that puts an exhausted job back.
    const q = queue('terminal-no-resurrect')
    await enqueueJob({ queue: q, maxAttempts: 1 })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    expect(await failJob(job, 'boom', { terminal: false })).toBe('failed')
  })
})

describe('bulk enqueue', () => {
  it('writes one row per input and reports what it wrote', async () => {
    const q = queue('bulk')
    const result = await enqueueJobs([
      { queue: q, dedupeKey: 'a', payload: { n: 1 } },
      { queue: q, dedupeKey: 'b', payload: { n: 2 } },
    ])
    expect(result.inserted).toBe(2)
    expect(result.insertedDedupeKeys.sort()).toEqual(['a', 'b'])
    expect(await rowsFor(q)).toHaveLength(2)
  })

  it('is a no-op on keys that already exist — the relay’s re-drain', async () => {
    const q = queue('bulk-dedupe')
    await enqueueJobs([{ queue: q, dedupeKey: 'k' }])
    const again = await enqueueJobs([
      { queue: q, dedupeKey: 'k' },
      { queue: q, dedupeKey: 'k2' },
    ])
    expect(again.inserted).toBe(1)
    expect(again.insertedDedupeKeys).toEqual(['k2'])
    expect(await rowsFor(q)).toHaveLength(2)
  })

  it('deduplicates within a single call, not just against existing rows', async () => {
    const q = queue('bulk-self-dedupe')
    const result = await enqueueJobs([
      { queue: q, dedupeKey: 'same' },
      { queue: q, dedupeKey: 'same' },
    ])
    expect(result.inserted).toBe(1)
    expect(await rowsFor(q)).toHaveLength(1)
  })
})

describe('cancel and lookup', () => {
  it('finds a job by its dedupe key, with its status', async () => {
    const q = queue('lookup')
    await enqueueJob({ queue: q, dedupeKey: 'wait-1' })
    const found = await findJobByDedupeKey(q, 'wait-1')
    expect(found?.status).toBe('pending')
    expect(await findJobByDedupeKey(q, 'nope')).toBeNull()
  })

  it('removes a pending job and frees its key', async () => {
    const q = queue('cancel')
    await enqueueJob({ queue: q, dedupeKey: 'c' })
    expect(await cancelJob(q, 'c')).toBe(1)
    expect(await rowsFor(q)).toHaveLength(0)
    expect((await enqueueJob({ queue: q, dedupeKey: 'c' })).inserted).toBe(true)
  })

  it('frees a key still held by a TERMINAL job', async () => {
    // Under the reference `removeOnComplete` freed the id, so a caller that
    // could not re-schedule a key it had already used would be a silent
    // behaviour change — and the workflow sweeper depends on exactly this to
    // give a parked run a fresh timer.
    const q = queue('cancel-terminal')
    await enqueueJob({ queue: q, dedupeKey: 't' })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    await completeJob(job)
    expect((await enqueueJob({ queue: q, dedupeKey: 't' })).inserted).toBe(false)

    expect(await cancelJob(q, 't')).toBe(1)
    expect((await enqueueJob({ queue: q, dedupeKey: 't' })).inserted).toBe(true)
  })

  it('refuses to remove a RUNNING job — its lease is what adjudicates it', async () => {
    const q = queue('cancel-running')
    await enqueueJob({ queue: q, dedupeKey: 'r' })
    await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    expect(await cancelJob(q, 'r')).toBe(0)
    expect((await rowsFor(q))[0].status).toBe('running')
  })
})

describe('per-queue retention', () => {
  it('applies a queue’s own window, and its own per-status split', async () => {
    // The reference kept `{event-hooks}` completions for a day and its failures
    // for a month, so "did this webhook fire?" stays answerable after the
    // successful traffic is gone.
    const q = queue('retention-split')
    await enqueueJob({ queue: q, dedupeKey: 'ok' })
    const [okJob] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    await completeJob(okJob)
    await enqueueJob({ queue: q, dedupeKey: 'bad', maxAttempts: 1 })
    const [badJob] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: LEASE }] })
    await failJob(badJob, 'nope')

    await testSql()`
      UPDATE job_queue SET finished_at = now() - interval '3 days' WHERE queue = ${q}
    `
    // One day for successes, thirty for failures: the success goes, the failure stays.
    await pruneTerminalJobs(7 * 24 * 60 * 60 * 1000, {
      [q]: { succeeded: 86_400_000, failed: 30 * 86_400_000 },
    })

    const rows = await rowsFor(q)
    expect(rows.map((r) => r.status)).toEqual(['failed'])
  })
})

describe('transactional enqueue', () => {
  it('commits the job with the caller transaction and does not nudge until then', async () => {
    const q = queue('tx-commit')
    currentWorkspaceKey = 'ws-tx'
    await testDb().transaction(async (tx) => {
      const { inserted } = await enqueueJob({ queue: q, payload: { n: 1 }, executor: tx })
      expect(inserted).toBe(true)
      expect(nudgeWorker).not.toHaveBeenCalled()
    })
    expect((await rowsFor(q)).length).toBe(1)
    expect(nudgeWorker).not.toHaveBeenCalled()
  })

  it('leaves no row when the caller transaction rolls back', async () => {
    const q = queue('tx-rollback')
    await expect(
      testDb().transaction(async (tx) => {
        await enqueueJob({ queue: q, payload: { n: 1 }, executor: tx })
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect((await rowsFor(q)).length).toBe(0)
    expect(nudgeWorker).not.toHaveBeenCalled()
  })
})
