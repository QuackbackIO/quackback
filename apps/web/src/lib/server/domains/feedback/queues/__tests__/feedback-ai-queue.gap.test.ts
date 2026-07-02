/**
 * Differential-coverage tests for the feedback-AI queue worker — every job-type
 * branch of the processor, the unknown-type UnrecoverableError, the redis-ready
 * timeout catch, the `failed` handler, enqueue, and close.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  add: vi.fn(() => Promise.resolve()),
  waitUntilReady: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  extract: vi.fn(() => Promise.resolve()),
  interpret: vi.fn(() => Promise.resolve()),
  cleanup: vi.fn(() => Promise.resolve()),
  error: vi.fn(),
  processor: undefined as undefined | ((job: unknown) => Promise<void>),
  failed: undefined as undefined | ((job: unknown, err: Error) => void),
}))

class FakeUnrecoverable extends Error {}
vi.mock('bullmq', () => ({
  Queue: class {
    add = m.add
    waitUntilReady = m.waitUntilReady
    close = m.close
  },
  Worker: class {
    constructor(_name: string, processor: (job: unknown) => Promise<void>) {
      m.processor = processor
    }
    on(event: string, cb: (job: unknown, err: Error) => void) {
      if (event === 'failed') m.failed = cb
    }
    close = m.close
  },
  UnrecoverableError: FakeUnrecoverable,
}))
vi.mock('@/lib/server/queue/redis-config', () => ({
  getQueueRedis: () => ({}),
  REDIS_READY_TIMEOUT_MS: 5000,
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: m.error, info: vi.fn(), debug: vi.fn() }) },
}))
vi.mock('../../pipeline/extraction.service', () => ({ extractSignals: m.extract }))
vi.mock('../../pipeline/interpretation.service', () => ({ interpretSignal: m.interpret }))
vi.mock('../../../ai/usage-log', () => ({ cleanupExpiredLogs: m.cleanup }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  m.waitUntilReady.mockResolvedValue(undefined)
  m.processor = undefined
  m.failed = undefined
})

const load = () => import('../feedback-ai-queue')

describe('feedback-ai queue', () => {
  it('processes every job type and throws on an unknown one', async () => {
    const { initFeedbackAiWorker } = await load()
    await initFeedbackAiWorker()
    await m.processor!({
      data: { type: 'extract-signals', rawItemId: 'r1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    })
    await m.processor!({
      data: { type: 'interpret-signal', signalId: 's1' },
      attemptsMade: 1,
      opts: { attempts: 3 },
    })
    await m.processor!({ data: { type: 'retention-cleanup' }, attemptsMade: 0, opts: {} })
    expect(m.extract).toHaveBeenCalledWith('r1')
    expect(m.interpret).toHaveBeenCalledWith('s1', { currentAttempt: 2, maxAttempts: 3 })
    expect(m.cleanup).toHaveBeenCalled()
    await expect(
      m.processor!({ data: { type: 'nope' }, attemptsMade: 0, opts: {} })
    ).rejects.toBeInstanceOf(FakeUnrecoverable)
  })

  it('handles the failed-handler branches', async () => {
    const { initFeedbackAiWorker } = await load()
    await initFeedbackAiWorker()
    m.failed!(null, new Error('x'))
    m.failed!({ attemptsMade: 3, opts: { attempts: 3 }, data: { type: 'a' } }, new Error('boom'))
    m.failed!({ attemptsMade: 1, opts: {}, data: { type: 'b' } }, new Error('soft'))
    expect(m.error).toHaveBeenCalledTimes(2)
  })

  it('enqueues jobs and closes the queue', async () => {
    const mod = await load()
    await mod.enqueueFeedbackAiJob({ type: 'retention-cleanup' } as never)
    expect(m.add).toHaveBeenCalledWith('ai:retention-cleanup', { type: 'retention-cleanup' })
    await mod.closeFeedbackAiQueue()
    expect(m.close).toHaveBeenCalledTimes(2)
    await mod.closeFeedbackAiQueue() // no-op when already closed
  })

  it('closes and rethrows when redis never becomes ready, resetting init', async () => {
    m.waitUntilReady.mockRejectedValueOnce(new Error('redis down'))
    const { initFeedbackAiWorker } = await load()
    await expect(initFeedbackAiWorker()).rejects.toThrow('redis down')
    expect(m.close).toHaveBeenCalled()
  })
})
