/**
 * BullMQ Event Processing Tests
 *
 * Tests for the event queue: job enqueuing, worker processing,
 * failure handling, and graceful shutdown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData, PostCreatedEvent } from '../types'

// --- Mocks ---

const mockQueueAddBulk = vi.fn().mockResolvedValue(undefined)
const mockQueueClose = vi.fn().mockResolvedValue(undefined)
const mockWorkerClose = vi.fn().mockResolvedValue(undefined)
const insertMocks = vi.hoisted(() => {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn(() => ({
    onConflictDoNothing,
  }))
  const dbInsert = vi.fn(() => ({
    values,
  }))
  return { dbInsert, values, onConflictDoNothing }
})

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

const mockGetHookTargets = vi.fn()
vi.mock('../targets', () => ({
  getHookTargets: (...args: unknown[]) => mockGetHookTargets(...args),
}))

const mockGetHook = vi.fn()
vi.mock('../registry', () => ({
  getHook: (...args: unknown[]) => mockGetHook(...args),
}))

// db mock: inline to avoid hoisting issues. Access via import for assertions.
vi.mock('@/lib/server/db', () => ({
  db: {
    insert: insertMocks.dbInsert,
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
  ticketExternalLinks: { _name: 'ticketExternalLinks' },
  postExternalLinks: { _name: 'postExternalLinks' },
  webhooks: {
    id: 'id',
    failureCount: 'failureCount',
    status: 'status',
    lastTriggeredAt: 'lastTriggeredAt',
    lastError: 'lastError',
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

function makeTicketCreatedEvent(): EventData {
  return {
    id: 'evt-ticket-created',
    type: 'ticket.created',
    timestamp: '2026-06-16T00:00:00.000Z',
    actor: { type: 'user', principalId: 'principal_1' },
    data: {
      ticket: {
        id: 'ticket_1',
        subject: 'Billing question',
      },
    },
  } as EventData
}

// --- Bootstrap ---
// Import once to initialize the module. The first processEvent call with targets
// triggers ensureQueue() which creates the Queue and Worker singletons.

import { processEvent, closeQueue } from '../process'
import { db } from '@/lib/server/db'

// --- Tests ---

describe('Event Processing (BullMQ)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('processEvent', () => {
    it('does nothing when there are no targets', async () => {
      mockGetHookTargets.mockResolvedValue([])

      await processEvent(makeEvent())

      expect(mockQueueAddBulk).not.toHaveBeenCalled()
    })

    it('enqueues all targets in a single addBulk call', async () => {
      const event = makeEvent()
      mockGetHookTargets.mockResolvedValue([
        { type: 'slack', target: { channelId: 'C1' }, config: { accessToken: 'tok' } },
        { type: 'webhook', target: { url: 'https://a.com' }, config: { secret: 's' } },
      ])

      await processEvent(event)

      expect(mockQueueAddBulk).toHaveBeenCalledTimes(1)
      expect(mockQueueAddBulk).toHaveBeenCalledWith([
        {
          name: 'post.created:slack',
          data: {
            hookType: 'slack',
            event,
            target: { channelId: 'C1' },
            config: { accessToken: 'tok' },
          },
        },
        {
          name: 'post.created:webhook',
          data: {
            hookType: 'webhook',
            event,
            target: { url: 'https://a.com' },
            config: { secret: 's' },
          },
        },
      ])
    })
  })

  describe('Worker processor', () => {
    // The processor is captured when initializeQueue runs (first processEvent with targets).
    // We need to ensure it's initialized before these tests run.
    async function ensureInitialized() {
      if (!capturedProcessor) {
        mockGetHookTargets.mockResolvedValue([{ type: 'test', target: {}, config: {} }])
        await processEvent(makeEvent())
      }
    }

    it('succeeds silently when hook returns success', async () => {
      await ensureInitialized()
      const mockHook = { run: vi.fn().mockResolvedValue({ success: true }) }
      mockGetHook.mockReturnValue(mockHook)

      await expect(capturedProcessor!(makeJob())).resolves.toBeUndefined()
      expect(mockHook.run).toHaveBeenCalled()
    })

    it('persists ticket external links for successful ticket.created hook results', async () => {
      await ensureInitialized()
      const mockHook = {
        run: vi.fn().mockResolvedValue({
          success: true,
          externalId: 'EXT-123',
          externalDisplayId: 'SUP-123',
          externalUrl: 'https://github.example/issues/123',
        }),
      }
      mockGetHook.mockReturnValue(mockHook)

      await capturedProcessor!(
        makeJob({
          data: {
            hookType: 'github',
            event: makeTicketCreatedEvent(),
            target: {},
            config: { integrationId: 'integration_1' },
          },
        })
      )

      expect(insertMocks.dbInsert).toHaveBeenCalledWith({ _name: 'ticketExternalLinks' })
      expect(insertMocks.values).toHaveBeenCalledWith({
        ticketId: 'ticket_1',
        integrationId: 'integration_1',
        integrationType: 'github',
        externalId: 'EXT-123',
        externalDisplayId: 'SUP-123',
        externalUrl: 'https://github.example/issues/123',
        syncDirection: 'outbound',
      })
      expect(insertMocks.onConflictDoNothing).toHaveBeenCalled()
    })

    it('persists post external links for successful post.created hook results', async () => {
      await ensureInitialized()
      const mockHook = {
        run: vi.fn().mockResolvedValue({
          success: true,
          externalId: 'LIN-123',
        }),
      }
      mockGetHook.mockReturnValue(mockHook)

      await capturedProcessor!(
        makeJob({
          data: {
            hookType: 'linear',
            event: makeEvent(),
            target: {},
            config: { integrationId: 'integration_linear' },
          },
        })
      )

      expect(insertMocks.dbInsert).toHaveBeenCalledWith({ _name: 'postExternalLinks' })
      expect(insertMocks.values).toHaveBeenCalledWith({
        postId: 'post_1',
        integrationId: 'integration_linear',
        integrationType: 'linear',
        externalId: 'LIN-123',
        externalDisplayId: null,
        externalUrl: null,
      })
      expect(insertMocks.onConflictDoNothing).toHaveBeenCalled()
    })

    it('does not persist external links when integrationId is missing', async () => {
      await ensureInitialized()
      const mockHook = {
        run: vi.fn().mockResolvedValue({
          success: true,
          externalId: 'EXT-123',
        }),
      }
      mockGetHook.mockReturnValue(mockHook)

      await capturedProcessor!(
        makeJob({
          data: {
            hookType: 'github',
            event: makeTicketCreatedEvent(),
            target: {},
            config: {},
          },
        })
      )

      expect(insertMocks.dbInsert).not.toHaveBeenCalled()
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
        mockGetHookTargets.mockResolvedValue([{ type: 'test', target: {}, config: {} }])
        await processEvent(makeEvent())
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
      // Ensure queue is initialized first
      mockGetHookTargets.mockResolvedValue([{ type: 'test', target: {}, config: {} }])
      await processEvent(makeEvent())

      await closeQueue()

      expect(mockWorkerClose).toHaveBeenCalled()
      expect(mockQueueClose).toHaveBeenCalled()
    })
  })
})
