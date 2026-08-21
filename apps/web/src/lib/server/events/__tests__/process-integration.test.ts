/**
 * Hook delivery end to end — real Postgres, real queue, real runner.
 *
 * Nothing about the queue is mocked here: `enqueueHookJobsWithIds` writes real
 * rows, `drainOnce` claims them through the shipped lease path, and `runJob`
 * resolves the shipped `events` definition — so the retry ladder under test is
 * the one `retry-schedule.ts` actually produces, not a fixture's idea of it.
 * Only the hook registry is stubbed, because that is what decides *what* runs.
 *
 * Rows are scoped to dedupe keys this file mints: `DATABASE_URL` points every
 * worktree on this machine at one shared `quackback_test`.
 */

import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest'
import type { PostCreatedEvent } from '../types'
import {
  cleanupDedupeKeys,
  closeHarness,
  ensureJobQueueSchema,
  testDb,
  testSql,
} from '@/lib/server/jobs/__tests__/harness'

const mockHookRun = vi.fn()
const mockGetHook = vi.fn()
vi.mock('../registry', () => ({
  getHook: (...args: unknown[]) => mockGetHook(...args),
}))

// The queue resolves `db` through the app's proxy; point it at the harness's
// own committing connection, keeping the real tables/operators so the handler's
// webhook and integration writes still compile against the real schema.
vi.mock('@/lib/server/db', async (importOriginal) => ({
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
}))

vi.mock('@/lib/server/tenancy/tenant-context', () => ({
  getCurrentTenant: () => null,
}))

// Passthrough mock — ensures Vitest resolves hook-utils through its mock
// system, which is required for consistent module graph resolution when
// other imports are mocked.
vi.mock('../hook-utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual }
})

import { EVENTS_QUEUE, enqueueHookJobsWithIds } from '../process'
import { drainOnce, runnerConfig } from '@/lib/server/jobs/runner'

const RUN = `it${process.pid}${Date.now().toString(36)}`
const keys: string[] = []

function makeEvent(overrides: Partial<PostCreatedEvent> = {}): PostCreatedEvent {
  return {
    id: `evt-${RUN}`,
    type: 'post.created',
    timestamp: new Date().toISOString(),
    actor: { type: 'user', userId: 'user_1', email: 'test@test.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'Integration Test Post',
        content: 'Testing the queue pipeline',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 0,
      },
    },
    ...overrides,
  }
}

/**
 * Enqueue as event-dispatch would, after resolving targets. The
 * deterministic content-hash key is event-dispatch's concern; here the
 * key only has to be unique to this run so cleanup can find it.
 */
async function enqueueViaRelay(
  event: PostCreatedEvent,
  targets: Array<{ type: string; target: unknown; config: Record<string, unknown> }>
): Promise<void> {
  const jobs = targets.map((t, i) => {
    const jobId = `${event.id}:${t.type}:${i}`
    keys.push(jobId)
    return {
      name: `${event.type}:${t.type}`,
      data: { hookType: t.type, event, target: t.target, config: t.config },
      jobId,
    }
  })
  await enqueueHookJobsWithIds(jobs)
}

/** Drain repeatedly until nothing more is claimable, or the budget runs out. */
async function drainUntilIdle(maxPasses = 20): Promise<number> {
  let claimed = 0
  for (let i = 0; i < maxPasses; i++) {
    const result = await drainOnce({ ...runnerConfig(), batchSize: 5 })
    claimed += result.claimed
    if (result.claimed === 0) break
  }
  return claimed
}

async function rowsForRun(): Promise<Array<{ status: string; attempts: number; run_at: Date }>> {
  return (await testSql()`
    SELECT status, attempts, run_at FROM job_queue
    WHERE queue = ${EVENTS_QUEUE} AND dedupe_key = ANY(${keys}::text[])
    ORDER BY id
  `) as unknown as Array<{ status: string; attempts: number; run_at: Date }>
}

beforeAll(async () => {
  await ensureJobQueueSchema()
})

// Each case counts its own hook calls, so a row an earlier case deliberately
// left pending (the dedupe case) must not be drained inside the next one's
// count. Settle everything runnable first, under a hook that does nothing.
beforeEach(async () => {
  mockGetHook.mockReturnValue({ run: vi.fn().mockResolvedValue({ success: true }) })
  await drainUntilIdle()
  mockHookRun.mockReset()
})

afterAll(async () => {
  await cleanupDedupeKeys(EVENTS_QUEUE, keys)
  await closeHarness()
})

describe('hook delivery, end to end on Postgres', () => {
  it('enqueues and processes a job through the real queue', async () => {
    const seen: Array<{ event: unknown; target: unknown; config: unknown }> = []
    mockHookRun.mockImplementation((event: unknown, target: unknown, config: unknown) => {
      seen.push({ event, target, config })
      return Promise.resolve({ success: true })
    })
    mockGetHook.mockReturnValue({ run: mockHookRun })

    const event = makeEvent({ id: `evt-${RUN}-single` })
    await enqueueViaRelay(event, [
      { type: 'test-hook', target: { channel: 'C123' }, config: { token: 'tok' } },
    ])

    await drainUntilIdle()

    expect(seen).toHaveLength(1)
    const {
      event: receivedEvent,
      target,
      config,
    } = seen[0] as {
      event: PostCreatedEvent
      target: { channel: string }
      config: { token: string }
    }
    expect(receivedEvent.id).toBe(event.id)
    expect(receivedEvent.type).toBe('post.created')
    expect(target.channel).toBe('C123')
    expect(config.token).toBe('tok')
    expect((await rowsForRun()).every((r) => r.status === 'succeeded')).toBe(true)
  })

  it('processes multiple targets from a single event', async () => {
    let callCount = 0
    mockHookRun.mockImplementation(() => {
      callCount++
      return Promise.resolve({ success: true })
    })
    mockGetHook.mockReturnValue({ run: mockHookRun })

    const event = makeEvent({ id: `evt-${RUN}-multi` })
    await enqueueViaRelay(event, [
      { type: 'test-hook', target: { channel: 'C1' }, config: {} },
      { type: 'test-hook', target: { channel: 'C2' }, config: {} },
      { type: 'test-hook', target: { channel: 'C3' }, config: {} },
    ])

    await drainUntilIdle()
    expect(callCount).toBe(3)
  })

  it('re-enqueuing the same keys is a no-op — a retried dispatch is safe', async () => {
    mockHookRun.mockResolvedValue({ success: true })
    mockGetHook.mockReturnValue({ run: mockHookRun })

    const event = makeEvent({ id: `evt-${RUN}-dedupe` })
    const targets = [{ type: 'test-hook', target: {}, config: {} }]
    await enqueueViaRelay(event, targets)
    // A retried dispatch re-enqueues the
    // SAME keys; the keys array grows but the table must not.
    await enqueueViaRelay(event, targets)

    const rows = (await testSql()`
      SELECT count(*)::int AS n FROM job_queue
      WHERE queue = ${EVENTS_QUEUE} AND dedupe_key = ${`${event.id}:test-hook:0`}
    `) as unknown as Array<{ n: number }>
    expect(rows[0].n).toBe(1)
  })

  it('retries on retryable failure then succeeds, on the real backoff curve', async () => {
    let attempts = 0
    mockHookRun.mockImplementation(() => {
      attempts++
      if (attempts < 3) {
        return Promise.resolve({
          success: false,
          shouldRetry: true,
          error: `Attempt ${attempts} failed`,
        })
      }
      return Promise.resolve({ success: true })
    })
    mockGetHook.mockReturnValue({ run: mockHookRun })

    const event = makeEvent({ id: `evt-${RUN}-retry` })
    await enqueueViaRelay(event, [{ type: 'test-hook', target: {}, config: {} }])

    // The first two retries of this queue's curve are 1s and 2s, so the job is
    // not claimable again until its `run_at` moves. Draining in a tight loop
    // proves that: without the wait the row is simply not runnable.
    await drainUntilIdle()
    expect(attempts).toBe(1)
    await new Promise((r) => setTimeout(r, 1200))
    await drainUntilIdle()
    expect(attempts).toBe(2)
    await new Promise((r) => setTimeout(r, 2200))
    await drainUntilIdle()
    expect(attempts).toBe(3)

    const rows = await rowsForRun()
    expect(rows.some((r) => r.status === 'succeeded' && r.attempts === 3)).toBe(true)
  }, 20000)

  it('does not retry a non-retryable failure', async () => {
    let callCount = 0
    mockHookRun.mockImplementation(() => {
      callCount++
      return Promise.resolve({ success: false, shouldRetry: false, error: 'Bad request' })
    })
    mockGetHook.mockReturnValue({ run: mockHookRun })

    const event = makeEvent({ id: `evt-${RUN}-perm` })
    await enqueueViaRelay(event, [{ type: 'test-hook', target: {}, config: {} }])

    await drainUntilIdle()
    // A terminal failure is final on the first attempt even though five more
    // were allowed — the control being that the retry case above, on the same
    // queue and the same `maxAttempts`, did run three times.
    expect(callCount).toBe(1)
    await new Promise((r) => setTimeout(r, 1500))
    await drainUntilIdle()
    expect(callCount).toBe(1)

    const rows = (await testSql()`
      SELECT status, attempts, last_error FROM job_queue
      WHERE queue = ${EVENTS_QUEUE} AND dedupe_key = ${`${event.id}:test-hook:0`}
    `) as unknown as Array<{ status: string; attempts: number; last_error: string }>
    expect(rows[0].status).toBe('failed')
    expect(rows[0].attempts).toBe(1)
    expect(rows[0].last_error).toContain('Bad request')
  }, 20000)
})
