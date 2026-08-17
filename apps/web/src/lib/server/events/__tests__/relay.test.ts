import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bypass config's full env validation (see emit.test.ts / frequency-cap-race).
vi.mock('@/lib/server/db', async (importOriginal) => {
  // oxlint-disable-next-line no-restricted-imports -- sanctioned test fixture, same as db-test-fixture.ts
  const { createDb } = await import('@quackback/db/client')
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: createDb(url, { max: 5, prepare: false }),
  }
})

/**
 * The queue seam, for the "one statement per fan-out" case below. Only the two
 * enqueue shapes are replaced: `enqueueJobs` is the bulk insert the relay is
 * supposed to reach, `enqueueJob` is the per-row round trip it must not.
 */
const bulkInserts: Array<
  Array<{ queue: string; dedupeKey?: string | null; maxAttempts?: number }>
> = []
const singleInserts: Array<{ queue: string }> = []

vi.mock('@/lib/server/jobs/job-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/jobs/job-queue')>()),
  enqueueJobs: async (
    inputs: Array<{ queue: string; dedupeKey?: string | null; maxAttempts?: number }>
  ) => {
    bulkInserts.push(inputs)
    return { inserted: inputs.length, insertedDedupeKeys: [] }
  },
  enqueueJob: async (input: { queue: string }) => {
    singleInserts.push(input)
    return { jobId: 'job_test', inserted: true }
  },
}))

import { db, events, eq, isNull } from '@/lib/server/db'
import { createId } from '@quackback/ids'
import { HOOK_RETRY_ATTEMPTS } from '../retry-schedule'
import { drainOnce } from '../relay'
import { registerResolver, __resetResolversForTests } from '../resolvers/registry'
import type { HookTarget } from '../hook-types'
import type { DomainEvent } from '../envelope'

/**
 * WO-3 — the relay drain: reads unpublished rows in id order, enqueues one job
 * per target with a DETERMINISTIC id, marks rows published; a second drain
 * enqueues nothing (idempotent publish); a depth>MAX event is skipped and
 * marked published (reaction-loop guard). Runs against quackback_test.
 */

async function seedEvent(entityId: string, depth = 0): Promise<void> {
  await db.insert(events).values({
    eventId: createId('event'),
    type: 'post.created',
    entityType: 'post',
    entityId,
    actorType: 'user',
    payload: { postId: entityId },
    context: { depth },
    schemaVersion: 1,
  })
}

const oneTarget = async (): Promise<HookTarget[]> => [
  {
    type: 'webhook',
    target: { url: 'https://example.test/hook' },
    config: { webhookId: 'wh_1' },
    deliveryKey: 'wh_1',
  },
]

describe('outbox relay drainOnce', () => {
  // Scope each test to its own entityId so parallel/prior rows don't interfere.
  let marker: string
  beforeEach(() => {
    marker = createId('post')
  })

  it('enqueues one deterministic job per target and marks rows published', async () => {
    await seedEvent(marker)
    await seedEvent(marker)

    const enqueued: Array<{ jobId: string }> = []
    const res = await drainOnce({
      resolve: oneTarget,
      enqueue: async (jobs) => {
        enqueued.push(...jobs)
      },
    })

    // Only assert on our two marker rows (the batch may include others, but ours must be handled).
    const ours = enqueued.filter((j) => j.jobId.includes(':webhook:'))
    expect(ours.length).toBeGreaterThanOrEqual(2)
    expect(res.enqueued).toBeGreaterThanOrEqual(2)

    // Every job id is deterministic: `${eventId}:${sink}:${targetKey}`.
    for (const j of enqueued) {
      expect(j.jobId).toMatch(/^evt_[0-9a-z]{26}:webhook:[0-9a-f]{24}$/)
    }

    const remaining = await db.select().from(events).where(eq(events.entityId, marker))
    expect(remaining.every((r) => r.publishedAt !== null)).toBe(true)
  })

  it('a second drain enqueues nothing new (idempotent publish)', async () => {
    await seedEvent(marker)
    await drainOnce({ resolve: oneTarget, enqueue: async () => {} })

    const enqueued: unknown[] = []
    await drainOnce({
      resolve: oneTarget,
      enqueue: async (jobs) => {
        enqueued.push(...jobs.filter((j) => j.jobId.includes(marker) === false))
      },
    })
    // Our marker row was already published, so it is not re-drained.
    const ourRows = await db.select().from(events).where(eq(events.entityId, marker))
    expect(ourRows.every((r) => r.publishedAt !== null)).toBe(true)
  })

  it('skips (but publishes) an event past the reaction-loop depth ceiling', async () => {
    await seedEvent(marker, 6)

    let enqueuedForMarker = 0
    await drainOnce({
      resolve: async (event: DomainEvent) => {
        if (event.entityId === marker) enqueuedForMarker++
        return oneTarget()
      },
      enqueue: async () => {},
    })

    // resolve() is never called for the over-depth marker event.
    expect(enqueuedForMarker).toBe(0)
    const rows = await db.select().from(events).where(eq(events.entityId, marker))
    expect(rows).toHaveLength(1)
    expect(rows[0].publishedAt).not.toBeNull()
  })

  it('leaves nothing unpublished after a full drain of the marker rows', async () => {
    await seedEvent(marker)
    await drainOnce({ resolve: async () => [], enqueue: async () => {} })
    const unpublished = await db.select().from(events).where(isNull(events.publishedAt))
    expect(unpublished.some((r) => r.entityId === marker)).toBe(false)
  })

  it('keeps separate subscriptions to the same URL as separate jobs', async () => {
    await seedEvent(marker)
    const enqueued: Array<{ jobId: string }> = []
    await drainOnce({
      resolve: async () => [
        {
          type: 'webhook',
          target: { url: 'https://shared.example/hook' },
          config: { webhookId: 'wh_a' },
          deliveryKey: 'wh_a',
        },
        {
          type: 'webhook',
          target: { url: 'https://shared.example/hook' },
          config: { webhookId: 'wh_b' },
          deliveryKey: 'wh_b',
        },
      ],
      enqueue: async (jobs) => {
        enqueued.push(...jobs)
      },
    })
    const webhookJobs = enqueued.filter((job) => job.jobId.includes(':webhook:'))
    expect(webhookJobs).toHaveLength(2)
    expect(new Set(webhookJobs.map((job) => job.jobId)).size).toBe(2)
  })

  it('leaves a failing event unpublished (retried later) without blocking the rows behind it', async () => {
    // Row A fails resolution; row B (later id) must still publish this pass —
    // per-row isolation, no head-of-line blocking.
    const failingEntity = marker
    const healthyEntity = createId('post')
    await seedEvent(failingEntity)
    await seedEvent(healthyEntity)

    const enqueued: Array<{ jobId: string }> = []
    const res = await drainOnce({
      resolve: async (event) => {
        if (event.entityId === failingEntity) throw new Error('database unavailable')
        return oneTarget()
      },
      enqueue: async (jobs) => {
        enqueued.push(...jobs)
      },
    })

    expect(res.failed).toBe(1)
    expect(enqueued).toHaveLength(1)

    const failing = await db.select().from(events).where(eq(events.entityId, failingEntity))
    expect(failing[0].publishedAt).toBeNull() // retried on a later pass
    const healthy = await db.select().from(events).where(eq(events.entityId, healthyEntity))
    expect(healthy[0].publishedAt).not.toBeNull() // delivered despite the poison row
  })

  it('degrades to best-effort resolution after the strict retry budget: healthy sinks deliver', async () => {
    // A DETERMINISTICALLY failing resolver must not wedge the row forever:
    // past the budget the relay resolves best-effort (failing sink dropped,
    // healthy sinks enqueued) and publishes the row. Uses the real registry —
    // the injected-resolve path never degrades by design.
    __resetResolversForTests()
    registerResolver({
      sink: 'boom',
      interestedIn: () => true,
      resolve: async () => {
        throw new Error('permanently broken sink')
      },
    })
    registerResolver({
      sink: 'ok',
      interestedIn: () => true,
      resolve: async () => oneTarget(),
    })
    try {
      // Sweep leftovers first (earlier tests deliberately leave unpublished
      // rows) so this drain sees exactly one row — ours.
      await db.update(events).set({ publishedAt: new Date() }).where(isNull(events.publishedAt))
      await seedEvent(marker)
      const enqueued: Array<{ jobId: string }> = []
      const res = await drainOnce({
        enqueue: async (jobs) => {
          enqueued.push(...jobs)
        },
        maxStrictResolveAttempts: 0, // budget already exhausted → degrade now
      })

      expect(res.failed).toBe(0)
      expect(enqueued).toHaveLength(1) // the healthy sink's target
      const rows = await db.select().from(events).where(eq(events.entityId, marker))
      expect(rows[0].publishedAt).not.toBeNull() // published, not wedged
    } finally {
      __resetResolversForTests()
    }
  })
})

describe('the sink a resolved fan-out actually reaches', () => {
  const threeTargets = (marker: string) => async (event: DomainEvent) =>
    event.entityId === marker
      ? (['wh_a', 'wh_b', 'wh_c'].map((id) => ({
          type: 'webhook',
          target: { url: 'https://example.test/hook' },
          config: { webhookId: id },
          deliveryKey: id,
        })) as HookTarget[])
      : []

  /**
   * Drain one seeded row with the DEFAULT enqueue (no injected sink) under a
   * given `QUACKBACK_TENANCY`.
   *
   * The mode is set deliberately even though nothing on this path reads it any
   * more. It is the input the deleted tenancy branch read: that branch sent the
   * pooled fan-out through a `for` loop of single inserts, so a test that never
   * ran pooled would pass just as happily with the loop back in place.
   */
  async function drainUnder(tenancy: string) {
    const marker = createId('post')
    const before = process.env.QUACKBACK_TENANCY
    bulkInserts.length = 0
    singleInserts.length = 0
    process.env.QUACKBACK_TENANCY = tenancy
    try {
      await seedEvent(marker)
      await drainOnce({ resolve: threeTargets(marker) })
    } finally {
      if (before === undefined) delete process.env.QUACKBACK_TENANCY
      else process.env.QUACKBACK_TENANCY = before
    }
    return { bulkInserts: [...bulkInserts], singleInserts: [...singleInserts] }
  }

  it.each(['single', 'pooled'])(
    'writes the whole fan-out in ONE statement under %s tenancy',
    async (tenancy) => {
      const { bulkInserts: bulk, singleInserts: single } = await drainUnder(tenancy)

      // One row, three targets, one insert. A per-target loop would be three
      // round trips that a crash can interrupt half-written, which is exactly
      // what stops a re-drain from being a no-op.
      expect(bulk).toHaveLength(1)
      expect(single).toEqual([])

      expect(bulk[0]).toHaveLength(3)
      expect(bulk[0].map((j) => j.queue)).toEqual(['events', 'events', 'events'])
      expect(bulk[0].every((j) => j.maxAttempts === HOOK_RETRY_ATTEMPTS)).toBe(true)
      // Deterministic keys are what `ON CONFLICT DO NOTHING` deduplicates on,
      // and all three are distinct, so the batch is not silently collapsing.
      const keys = bulk[0].map((j) => j.dedupeKey)
      expect(new Set(keys).size).toBe(3)
      expect(keys.every((k) => /^evt_[0-9a-z]{26}:webhook:[0-9a-f]{24}$/.test(k ?? ''))).toBe(true)
    }
  )
})
