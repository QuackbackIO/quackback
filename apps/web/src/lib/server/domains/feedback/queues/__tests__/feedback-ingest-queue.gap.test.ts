/**
 * Differential-coverage tests for the feedback-ingest queue worker — every
 * job-type branch, the unknown-type UnrecoverableError, the redis-ready timeout
 * catch, the `failed` handler, enqueue, and close.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  add: vi.fn(() => Promise.resolve()),
  waitUntilReady: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  enrich: vi.fn(() => Promise.resolve()),
  error: vi.fn(),
  debug: vi.fn(),
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
  logger: { child: () => ({ error: m.error, info: vi.fn(), debug: m.debug }) },
}))
vi.mock('../../ingestion/feedback-ingest.service', () => ({ enrichAndAdvance: m.enrich }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  m.waitUntilReady.mockResolvedValue(undefined)
  m.processor = undefined
  m.failed = undefined
})

const load = () => import('../feedback-ingest-queue')

describe('feedback-ingest queue', () => {
  it('processes every job type and throws on an unknown one', async () => {
    const mod = await load()
    await mod.enqueueFeedbackIngestJob({ type: 'enrich-context', rawItemId: 'r1' } as never)
    await m.processor!({ data: { type: 'enrich-context', rawItemId: 'r1' } })
    await m.processor!({ data: { type: 'poll-source', sourceId: 's1' } })
    await m.processor!({ data: { type: 'parse-batch', sourceId: 's2' } })
    expect(m.enrich).toHaveBeenCalledWith('r1')
    expect(m.debug).toHaveBeenCalledTimes(2)
    await expect(m.processor!({ data: { type: 'nope' } })).rejects.toBeInstanceOf(FakeUnrecoverable)
  })

  it('handles the failed-handler branches', async () => {
    const mod = await load()
    await mod.enqueueFeedbackIngestJob({ type: 'enrich-context', rawItemId: 'r1' } as never)
    m.failed!(null, new Error('x'))
    m.failed!({ attemptsMade: 3, opts: { attempts: 3 }, data: { type: 'a' } }, new Error('boom'))
    m.failed!({ attemptsMade: 1, opts: {}, data: { type: 'b' } }, new Error('soft'))
    expect(m.error).toHaveBeenCalledTimes(2)
  })

  it('closes the queue (and no-ops when already closed)', async () => {
    const mod = await load()
    await mod.enqueueFeedbackIngestJob({ type: 'enrich-context', rawItemId: 'r1' } as never)
    await mod.closeFeedbackIngestQueue()
    expect(m.close).toHaveBeenCalledTimes(2)
    await mod.closeFeedbackIngestQueue()
  })

  it('closes and rethrows when redis never becomes ready', async () => {
    m.waitUntilReady.mockRejectedValueOnce(new Error('redis down'))
    const mod = await load()
    await expect(
      mod.enqueueFeedbackIngestJob({ type: 'enrich-context', rawItemId: 'r1' } as never)
    ).rejects.toThrow('redis down')
    expect(m.close).toHaveBeenCalled()
  })
})
