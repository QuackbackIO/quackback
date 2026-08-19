/**
 * Durable workflow-dispatch queue tests (§4.6 hardening). Mirrors
 * events/__tests__/process.test.ts's bullmq-mocking convention: 'bullmq' is
 * fully mocked so no real Redis is touched, and the mock Queue/Worker
 * classes capture the processor + failure handler for direct invocation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '@/lib/server/events/types'

const mockQueueAdd = vi.fn().mockResolvedValue(undefined)
const mockQueueClose = vi.fn().mockResolvedValue(undefined)
const mockWorkerClose = vi.fn().mockResolvedValue(undefined)

let capturedProcessor: ((job: unknown) => Promise<void>) | null = null
let capturedFailedHandler: ((job: unknown, error: Error) => void) | null = null
let capturedWorkerOpts: { concurrency?: number } | null = null

vi.mock('bullmq', () => {
  class MockQueue {
    add = mockQueueAdd
    close = mockQueueClose
    waitUntilReady = vi.fn().mockResolvedValue(undefined)
    constructor() {}
  }
  class MockWorker {
    close = mockWorkerClose
    constructor(_name: string, processor: unknown, opts: { concurrency?: number }) {
      capturedProcessor = processor as (job: unknown) => Promise<void>
      capturedWorkerOpts = opts
    }
    on(event: string, handler: unknown) {
      if (event === 'failed') {
        capturedFailedHandler = handler as (job: unknown, error: Error) => void
      }
      return this
    }
  }
  return { Queue: MockQueue, Worker: MockWorker }
})

vi.mock('@/lib/server/config', () => ({
  config: { redisUrl: 'redis://localhost:6379' },
}))

const mockDispatchWorkflowsForEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('../event-trigger', () => ({
  dispatchWorkflowsForEvent: (...args: unknown[]) => mockDispatchWorkflowsForEvent(...args),
}))

import { enqueueWorkflowDispatch, closeWorkflowDispatchQueue } from '../workflow-dispatch-queue'

function makeEvent(overrides: Partial<EventData> = {}): EventData {
  return {
    id: 'evt-123',
    type: 'conversation.created',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1' },
    data: {
      conversation: { id: 'conversation_1', channel: 'messenger', visitorPrincipalId: null },
    },
    ...overrides,
  } as unknown as EventData
}

// The queue/worker are module-level singletons (lazy init on first enqueue),
// mirroring process.test.ts's convention: initialize once, then reuse the
// captured processor/failure-handler across tests in this file.
async function ensureInitialized(): Promise<void> {
  if (!capturedProcessor) {
    await enqueueWorkflowDispatch(makeEvent())
  }
}

describe('workflow-dispatch queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Runs first, before any other test triggers lazy init, so the queue is
  // genuinely uninitialized here.
  it('closeWorkflowDispatchQueue is a no-op when the queue was never initialized', async () => {
    await expect(closeWorkflowDispatchQueue()).resolves.toBeUndefined()
    expect(mockWorkerClose).not.toHaveBeenCalled()
  })

  describe('enqueueWorkflowDispatch', () => {
    it('adds a job keyed by the event id, so a double-enqueue dedupes', async () => {
      const event = makeEvent()
      await enqueueWorkflowDispatch(event)

      expect(mockQueueAdd).toHaveBeenCalledTimes(1)
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'dispatch',
        { event },
        { jobId: 'workflow-dispatch:evt-123' }
      )
    })

    it('derives a distinct jobId per event id', async () => {
      await enqueueWorkflowDispatch(makeEvent({ id: 'evt-a' }))
      await enqueueWorkflowDispatch(makeEvent({ id: 'evt-b' }))

      expect(mockQueueAdd.mock.calls[0][2]).toEqual({ jobId: 'workflow-dispatch:evt-a' })
      expect(mockQueueAdd.mock.calls[1][2]).toEqual({ jobId: 'workflow-dispatch:evt-b' })
    })
  })

  describe('worker processor', () => {
    it('calls dispatchWorkflowsForEvent with the job event', async () => {
      await ensureInitialized()
      const event = makeEvent({ id: 'evt-999' })

      await capturedProcessor!({ data: { event } })

      expect(mockDispatchWorkflowsForEvent).toHaveBeenCalledWith(event)
    })

    it('runs with concurrency 1, so two events on the same conversation process in enqueue order', async () => {
      await ensureInitialized()
      expect(capturedWorkerOpts?.concurrency).toBe(1)
    })

    it('propagates a dispatch failure so BullMQ retries the job', async () => {
      await ensureInitialized()
      mockDispatchWorkflowsForEvent.mockRejectedValueOnce(new Error('transient db error'))

      await expect(capturedProcessor!({ data: { event: makeEvent() } })).rejects.toThrow(
        'transient db error'
      )
    })
  })

  describe("worker.on('failed')", () => {
    it('logs without throwing when job is null', async () => {
      await ensureInitialized()
      expect(() => capturedFailedHandler!(null, new Error('boom'))).not.toThrow()
    })

    it('logs the event id/type and attempt count on failure', async () => {
      await ensureInitialized()
      const job = {
        data: { event: makeEvent({ id: 'evt-fail' }) },
        attemptsMade: 3,
        opts: { attempts: 3 },
      }
      expect(() => capturedFailedHandler!(job, new Error('permanent'))).not.toThrow()
    })
  })

  describe('closeWorkflowDispatchQueue', () => {
    it('closes worker and queue gracefully', async () => {
      await ensureInitialized()
      await closeWorkflowDispatchQueue()

      expect(mockWorkerClose).toHaveBeenCalled()
      expect(mockQueueClose).toHaveBeenCalled()
    })
  })
})
