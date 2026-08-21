/**
 * Event hook delivery on the Postgres queue.
 *
 * Covers the producer side (`process.ts`) and the handler (`hook-job.ts`). The
 * four properties this queue is easiest to lose in a move each get a case:
 * the retry curve, the retryable/terminal classification, the delayed-job
 * lifecycle, and the webhook auto-disable side effect's dependence on a
 * failure being *permanent*.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostCreatedEvent } from '../types'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

// --- Mocks ---

const enqueued: Array<{ queue: string; dedupeKey?: string | null; runAt?: Date }> = []
const bulkEnqueued: Array<Array<{ queue: string; dedupeKey?: string | null }>> = []
const cancelled: Array<{ queue: string; dedupeKey: string }> = []

vi.mock('@/lib/server/jobs/job-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/jobs/job-queue')>()),
  enqueueJob: async (input: { queue: string; dedupeKey?: string | null; runAt?: Date }) => {
    enqueued.push(input)
    return { jobId: 'job_test', inserted: true }
  },
  enqueueJobs: async (inputs: Array<{ queue: string; dedupeKey?: string | null }>) => {
    bulkEnqueued.push(inputs)
    return { inserted: inputs.length, insertedDedupeKeys: [] }
  },
  cancelJob: async (queue: string, dedupeKey: string) => {
    cancelled.push({ queue, dedupeKey })
    return 1
  },
}))

// EVENTING-V2: processEvent now writes to the outbox (the relay enqueues).
const mockWriteEventToOutbox = vi.fn().mockResolvedValue(true)
vi.mock('../outbox-dispatch', () => ({
  writeEventToOutbox: (...args: unknown[]) => mockWriteEventToOutbox(...args),
}))

const mockGetHook = vi.fn()
vi.mock('../registry', () => ({
  getHook: (...args: unknown[]) => mockGetHook(...args),
}))

// db mock: inline to avoid hoisting issues. Access via import for assertions.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
  eq: vi.fn(),
  sql: vi.fn(),
}))

// --- Helpers ---

function makeEvent(): PostCreatedEvent {
  return {
    id: 'evt-123',
    type: 'post.created',
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1', email: 'test@test.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'Test',
        content: 'Content',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 0,
      },
    },
  }
}

function makeJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: '1',
    jobId: 'job_1',
    queue: 'events',
    dedupeKey: 'evt-123:webhook:abc',
    payload: {
      hookType: 'webhook',
      event: makeEvent(),
      target: { url: 'https://example.com/hook' },
      config: { secret: 'secret', webhookId: 'wh_1' },
    },
    tenantId: null,
    attempts: 1,
    maxAttempts: 6,
    leaseToken: '00000000-0000-0000-0000-000000000000',
    lockedUntil: new Date(),
    ...overrides,
  }
}

import {
  EVENTS_QUEUE,
  addDelayedJob,
  closeQueue,
  enqueueHookJobsWithIds,
  processEvent,
  removeDelayedJob,
} from '../process'
import { onHookJobFailure, runHookJob, type HookJobData } from '../hook-job'
import { db } from '@/lib/server/db'
import {
  findJobDefinition,
  isTerminalJobError,
  maxAttemptsFor,
} from '@/lib/server/jobs/definitions'
import { retryBackoffMs } from '@/lib/server/jobs/definitions'

// --- Tests ---

describe('Event processing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enqueued.length = 0
    bulkEnqueued.length = 0
    cancelled.length = 0
  })

  describe('processEvent', () => {
    // EVENTING-V2 (WO-18): processEvent writes to the durable outbox; the relay
    // is the sole enqueuer, so processEvent never touches the queue directly.
    // The relay's drain→enqueue is covered by relay.test.ts.
    it('writes the event to the outbox and does not enqueue directly', async () => {
      const event = makeEvent()
      await processEvent(event)

      expect(mockWriteEventToOutbox).toHaveBeenCalledWith(event)
      expect(bulkEnqueued).toHaveLength(0)
    })
  })

  describe('the retry curve', () => {
    it('keeps retrying a failed delivery roughly six hours after the first failure', () => {
      const def = findJobDefinition(EVENTS_QUEUE)
      expect(def).toBeDefined()
      // Six total attempts: first try + two fast retries + three slow ones.
      expect(maxAttemptsFor(def!)).toBe(6)
      // Fast retries clear transient blips in seconds…
      expect(retryBackoffMs(def!, 1)).toBeLessThan(60_000)
      expect(retryBackoffMs(def!, 2)).toBeLessThan(60_000)
      // …and the jittered slow tail (1h/2h/4h base) keeps a retry pending
      // past the six-hour mark even at the jitter floor.
      const span = [1, 2, 3, 4, 5].reduce((sum, n) => sum + retryBackoffMs(def!, n), 0)
      expect(span).toBeGreaterThanOrEqual(6 * 3_600_000)
    })

    it('is not the geometric default — the curve is the queue’s own', () => {
      // The control: were `events` left on the default doubling curve from 5s,
      // its fifth delay would be 80 seconds rather than hours, and the case
      // above would still pass on `attempts` alone.
      const def = findJobDefinition(EVENTS_QUEUE)
      const geometric = 5_000 * 2 ** 4
      expect(retryBackoffMs(def!, 5)).toBeGreaterThan(geometric * 100)
    })
  })

  describe('the enqueue shapes', () => {
    it('bulk-enqueues one row per target, keyed for dedupe', async () => {
      const data = makeJob().payload as unknown as HookJobData
      await enqueueHookJobsWithIds([
        { name: 'post.created:webhook', data, jobId: 'evt-1:webhook:aaa' },
        { name: 'post.created:slack', data, jobId: 'evt-1:slack:bbb' },
      ])
      expect(bulkEnqueued).toHaveLength(1)
      expect(bulkEnqueued[0].map((j) => j.dedupeKey)).toEqual([
        'evt-1:webhook:aaa',
        'evt-1:slack:bbb',
      ])
      expect(bulkEnqueued[0].every((j) => j.queue === EVENTS_QUEUE)).toBe(true)
    })

    it('does nothing for an empty fan-out', async () => {
      await enqueueHookJobsWithIds([])
      expect(bulkEnqueued).toHaveLength(0)
    })

    it('schedules a delayed job into the future under a cancelable key', async () => {
      const before = Date.now()
      await addDelayedJob(
        '__changelog_publish__',
        { hookType: '__changelog_publish__' } as unknown as HookJobData,
        { delay: 60_000, jobId: 'changelog:cl_1' }
      )
      expect(enqueued).toHaveLength(1)
      expect(enqueued[0].dedupeKey).toBe('changelog:cl_1')
      expect(enqueued[0].runAt!.getTime()).toBeGreaterThanOrEqual(before + 60_000)
    })

    it('cancels a delayed job by its key', async () => {
      await removeDelayedJob('changelog:cl_1')
      expect(cancelled).toEqual([{ queue: EVENTS_QUEUE, dedupeKey: 'changelog:cl_1' }])
    })

    it('closeQueue is a no-op now the queue is a table', async () => {
      await expect(closeQueue()).resolves.toBeUndefined()
    })
  })

  describe('runHookJob', () => {
    it('succeeds silently when hook returns success', async () => {
      const mockHook = { run: vi.fn().mockResolvedValue({ success: true }) }
      mockGetHook.mockReturnValue(mockHook)

      await expect(runHookJob(makeJob())).resolves.toBeUndefined()
      expect(mockHook.run).toHaveBeenCalled()
    })

    it('passes the dedupe key as the idempotency handle, so a retry dedupes', async () => {
      const mockHook = { run: vi.fn().mockResolvedValue({ success: true }) }
      mockGetHook.mockReturnValue(mockHook)

      await runHookJob(makeJob())
      expect(mockHook.run.mock.calls[0][3]).toEqual({ jobId: 'evt-123:webhook:abc' })
    })

    it('falls back to the branded job id when a row carries no dedupe key', async () => {
      const mockHook = { run: vi.fn().mockResolvedValue({ success: true }) }
      mockGetHook.mockReturnValue(mockHook)

      await runHookJob(makeJob({ dedupeKey: null, jobId: 'job_fallback' }))
      expect(mockHook.run.mock.calls[0][3]).toEqual({ jobId: 'job_fallback' })
    })

    it('throws a terminal error for an unknown hook type', async () => {
      mockGetHook.mockReturnValue(undefined)

      const err = (await runHookJob(makeJob()).catch((e: unknown) => e)) as Error
      expect(err.message).toBe('Unknown hook: webhook')
      expect(isTerminalJobError(err)).toBe(true)
    })

    it('throws a RETRYABLE error when hook returns shouldRetry: true', async () => {
      mockGetHook.mockReturnValue({
        run: vi
          .fn()
          .mockResolvedValue({ success: false, shouldRetry: true, error: 'Rate limited' }),
      })

      const err = (await runHookJob(makeJob()).catch((e: unknown) => e)) as Error
      expect(err).toBeInstanceOf(Error)
      expect(isTerminalJobError(err)).toBe(false)
      expect(err.message).toBe('Rate limited')
    })

    it('throws a terminal error when hook returns shouldRetry: false', async () => {
      mockGetHook.mockReturnValue({
        run: vi
          .fn()
          .mockResolvedValue({ success: false, shouldRetry: false, error: 'Bad request' }),
      })

      const err = (await runHookJob(makeJob()).catch((e: unknown) => e)) as Error
      expect(isTerminalJobError(err)).toBe(true)
      expect(err.message).toBe('Bad request')
    })

    it('rethrows retryable errors from hook.run', async () => {
      const networkError = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      mockGetHook.mockReturnValue({ run: vi.fn().mockRejectedValue(networkError) })

      const err = (await runHookJob(makeJob()).catch((e: unknown) => e)) as Error
      expect(err.message).toBe('connection reset')
      expect(isTerminalJobError(err)).toBe(false)
    })

    it('wraps non-retryable errors from hook.run as terminal', async () => {
      mockGetHook.mockReturnValue({
        run: vi.fn().mockRejectedValue(new TypeError('Cannot read property')),
      })

      const err = (await runHookJob(makeJob()).catch((e: unknown) => e)) as Error
      expect(isTerminalJobError(err)).toBe(true)
      expect(err.message).toBe('Cannot read property')
    })
  })

  describe('onHookJobFailure — the webhook auto-disable side effect', () => {
    it('does not touch the failure count while attempts remain', async () => {
      await onHookJobFailure(makeJob(), new Error('timeout'), false)
      expect(db.update).not.toHaveBeenCalled()
    })

    it('increments the failure count once the failure is permanent', async () => {
      await onHookJobFailure(makeJob(), new Error('permanent'), true)
      expect(db.update).toHaveBeenCalled()
    })

    it('skips the failure count for non-webhook hooks', async () => {
      const job = makeJob()
      ;(job.payload as { hookType: string }).hookType = 'slack'
      await onHookJobFailure(job, new Error('permanent'), true)
      expect(db.update).not.toHaveBeenCalled()
    })

    it('skips the failure count when webhookId is missing', async () => {
      const job = makeJob()
      ;(job.payload as { config: Record<string, unknown> }).config = { secret: 's' }
      await onHookJobFailure(job, new Error('permanent'), true)
      expect(db.update).not.toHaveBeenCalled()
    })
  })
})
