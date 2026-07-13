/**
 * BullMQ Event Processing Tests
 *
 * Tests for the event queue: job enqueuing, worker processing,
 * failure handling, and graceful shutdown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostCreatedEvent } from '../types'

// --- Mocks ---

const mockQueueAddBulk = vi.fn().mockResolvedValue(undefined)
const mockQueueClose = vi.fn().mockResolvedValue(undefined)
const mockWorkerClose = vi.fn().mockResolvedValue(undefined)

// Captured once when the Worker is constructed (module-level singleton)
let capturedProcessor: ((job: unknown) => Promise<void>) | null = null
let capturedFailedHandler: ((job: unknown, error: Error) => void) | null = null

vi.mock('bullmq', () => {
  class MockQueue {
    addBulk = mockQueueAddBulk
    close = mockQueueClose
    waitUntilReady = vi.fn().mockResolvedValue(undefined)
    constructor() {}
  }
  class MockWorker {
    close = mockWorkerClose
    constructor(_name: string, processor: unknown) {
      capturedProcessor = processor as (job: unknown) => Promise<void>
    }
    on(event: string, handler: unknown) {
      if (event === 'failed') {
        capturedFailedHandler = handler as (job: unknown, error: Error) => void
      }
      return this
    }
  }
  class UnrecoverableError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'UnrecoverableError'
    }
  }
  return { Queue: MockQueue, Worker: MockWorker, UnrecoverableError }
})

vi.mock('@/lib/server/config', () => ({
  config: { redisUrl: 'redis://localhost:6379' },
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

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      hookType: 'webhook',
      event: makeEvent(),
      target: { url: 'https://example.com/hook' },
      config: { secret: 'secret', webhookId: 'wh_1' },
    },
    attemptsMade: 1,
    opts: { attempts: 3 },
    ...overrides,
  }
}

// --- Bootstrap ---
// Import once to initialize the module. The first processEvent call with targets
// triggers ensureQueue() which creates the Queue and Worker singletons.

import { processEvent, closeQueue, enqueueHookJobsWithIds } from '../process'
import { db } from '@/lib/server/db'

// --- Tests ---

describe('Event Processing (BullMQ)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('processEvent', () => {
    // EVENTING-V2 (WO-18): processEvent writes to the durable outbox; the relay
    // is the sole enqueuer, so processEvent never touches the queue directly.
    // The relay's drain→enqueue is covered by relay.test.ts.
    it('writes the event to the outbox and does not enqueue directly', async () => {
      const event = makeEvent()
      await processEvent(event)

      expect(mockWriteEventToOutbox).toHaveBeenCalledWith(event)
      expect(mockQueueAddBulk).not.toHaveBeenCalled()
    })
  })

  describe('Worker processor', () => {
    // The processor is captured when initializeQueue runs (first enqueue).
    // Trigger init via the relay's enqueue helper (processEvent no longer
    // enqueues — it writes the outbox).
    async function ensureInitialized() {
      if (!capturedProcessor) {
        await enqueueHookJobsWithIds([{ name: 'init', data: makeJob().data, jobId: 'init:1' }])
      }
    }

    it('succeeds silently when hook returns success', async () => {
      await ensureInitialized()
      const mockHook = { run: vi.fn().mockResolvedValue({ success: true }) }
      mockGetHook.mockReturnValue(mockHook)

      await expect(capturedProcessor!(makeJob())).resolves.toBeUndefined()
      expect(mockHook.run).toHaveBeenCalled()
    })

    it('throws UnrecoverableError for unknown hook type', async () => {
      await ensureInitialized()
      mockGetHook.mockReturnValue(undefined)

      await expect(capturedProcessor!(makeJob())).rejects.toThrow('Unknown hook: webhook')
    })

    it('throws regular Error when hook returns shouldRetry: true', async () => {
      await ensureInitialized()
      const mockHook = {
        run: vi.fn().mockResolvedValue({
          success: false,
          shouldRetry: true,
          error: 'Rate limited',
        }),
      }
      mockGetHook.mockReturnValue(mockHook)

      const err = (await capturedProcessor!(makeJob()).catch((e: unknown) => e)) as Error
      expect(err).toBeInstanceOf(Error)
      expect(err.name).not.toBe('UnrecoverableError')
      expect(err.message).toBe('Rate limited')
    })

    it('throws UnrecoverableError when hook returns shouldRetry: false', async () => {
      await ensureInitialized()
      const mockHook = {
        run: vi.fn().mockResolvedValue({
          success: false,
          shouldRetry: false,
          error: 'Bad request',
        }),
      }
      mockGetHook.mockReturnValue(mockHook)

      const err = (await capturedProcessor!(makeJob()).catch((e: unknown) => e)) as Error
      expect(err.name).toBe('UnrecoverableError')
      expect(err.message).toBe('Bad request')
    })

    it('rethrows retryable errors from hook.run', async () => {
      await ensureInitialized()
      const networkError = Object.assign(new Error('connection reset'), {
        code: 'ECONNRESET',
      })
      const mockHook = { run: vi.fn().mockRejectedValue(networkError) }
      mockGetHook.mockReturnValue(mockHook)

      const err = (await capturedProcessor!(makeJob()).catch((e: unknown) => e)) as Error
      expect(err.message).toBe('connection reset')
      expect(err.name).not.toBe('UnrecoverableError')
    })

    it('wraps non-retryable errors from hook.run as UnrecoverableError', async () => {
      await ensureInitialized()
      const typeError = new TypeError('Cannot read property')
      const mockHook = { run: vi.fn().mockRejectedValue(typeError) }
      mockGetHook.mockReturnValue(mockHook)

      const err = (await capturedProcessor!(makeJob()).catch((e: unknown) => e)) as Error
      expect(err.name).toBe('UnrecoverableError')
      expect(err.message).toBe('Cannot read property')
    })
  })

  describe('worker.on("failed")', () => {
    async function ensureInitialized() {
      if (!capturedFailedHandler) {
        await enqueueHookJobsWithIds([{ name: 'init', data: makeJob().data, jobId: 'init:failed' }])
      }
    }

    it('does nothing when job is null', async () => {
      await ensureInitialized()
      capturedFailedHandler!(null, new Error('test'))
      expect(db.update).not.toHaveBeenCalled()
    })

    it('does not update webhook failure count on non-permanent failure', async () => {
      await ensureInitialized()
      const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } })

      capturedFailedHandler!(job, new Error('timeout'))

      await new Promise((r) => setTimeout(r, 10))
      expect(db.update).not.toHaveBeenCalled()
    })

    it('updates webhook failure count on permanent failure (retries exhausted)', async () => {
      await ensureInitialized()
      const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } })

      capturedFailedHandler!(job, new Error('permanent'))

      await new Promise((r) => setTimeout(r, 10))
      expect(db.update).toHaveBeenCalled()
    })

    it('updates webhook failure count on UnrecoverableError (even if attemptsMade < attempts)', async () => {
      await ensureInitialized()
      // UnrecoverableError skips retries, so attemptsMade is only 1
      const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } })
      const error = new Error('SSRF blocked')
      error.name = 'UnrecoverableError'

      capturedFailedHandler!(job, error)

      await new Promise((r) => setTimeout(r, 10))
      expect(db.update).toHaveBeenCalled()
    })

    it('skips failure count update for non-webhook hooks', async () => {
      await ensureInitialized()
      const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } })
      ;(job.data as { hookType: string }).hookType = 'slack'

      capturedFailedHandler!(job, new Error('permanent'))

      await new Promise((r) => setTimeout(r, 10))
      expect(db.update).not.toHaveBeenCalled()
    })

    it('skips failure count update when webhookId is missing', async () => {
      await ensureInitialized()
      const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } })
      ;(job.data as { config: Record<string, unknown> }).config = { secret: 's' }

      capturedFailedHandler!(job, new Error('permanent'))

      await new Promise((r) => setTimeout(r, 10))
      expect(db.update).not.toHaveBeenCalled()
    })
  })

  describe('closeQueue', () => {
    it('closes worker and queue gracefully', async () => {
      // Ensure queue is initialized first (via the relay's enqueue helper).
      await enqueueHookJobsWithIds([{ name: 'init', data: makeJob().data, jobId: 'init:close' }])

      await closeQueue()

      expect(mockWorkerClose).toHaveBeenCalled()
      expect(mockQueueClose).toHaveBeenCalled()
    })
  })
})
