/**
 * Differential-coverage tests for the anon-sweep queue worker — job processing
 * (with and without reclaimed principals), the redis-ready timeout catch, the
 * `failed` handler branches, and the init-promise singleton.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  add: vi.fn(() => Promise.resolve()),
  waitUntilReady: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  sweep: vi.fn(() => Promise.resolve({ deleted: 0, candidates: 0 })),
  error: vi.fn(),
  debug: vi.fn(),
  processor: undefined as undefined | ((job: unknown) => Promise<void>),
  failed: undefined as undefined | ((job: unknown, err: Error) => void),
}))

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
}))
vi.mock('@/lib/server/queue/redis-config', () => ({
  getQueueRedis: () => ({}),
  REDIS_READY_TIMEOUT_MS: 5000,
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: m.error, info: vi.fn(), debug: m.debug }) },
}))
vi.mock('../anon-sweep.service', () => ({ sweepAnonymousPrincipals: m.sweep }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  m.waitUntilReady.mockResolvedValue(undefined)
  m.sweep.mockResolvedValue({ deleted: 0, candidates: 0 })
  m.processor = undefined
  m.failed = undefined
})

const load = () => import('../anon-sweep-queue')

describe('anon-sweep queue', () => {
  it('processes a sweep job, logging only when something was reclaimed', async () => {
    const { initAnonSweepWorker } = await load()
    await initAnonSweepWorker()
    await m.processor!({ data: { type: 'sweep-anonymous' } })
    expect(m.debug).not.toHaveBeenCalled()
    m.sweep.mockResolvedValueOnce({ deleted: 2, candidates: 5 })
    await m.processor!({ data: { type: 'sweep-anonymous' } })
    expect(m.debug).toHaveBeenCalledTimes(1)
    await m.processor!({ data: { type: 'other' } })
    expect(m.sweep).toHaveBeenCalledTimes(2)
  })

  it('handles the failed-handler branches', async () => {
    const { initAnonSweepWorker } = await load()
    await initAnonSweepWorker()
    m.failed!(null, new Error('x'))
    m.failed!({ attemptsMade: 3, opts: { attempts: 3 } }, new Error('boom'))
    m.failed!({ attemptsMade: 1, opts: {} }, new Error('soft'))
    expect(m.error).toHaveBeenCalledTimes(2)
  })

  it('closes and rethrows when redis never becomes ready', async () => {
    m.waitUntilReady.mockRejectedValueOnce(new Error('redis down'))
    const { initAnonSweepWorker } = await load()
    await expect(initAnonSweepWorker()).rejects.toThrow('redis down')
    expect(m.close).toHaveBeenCalled()
  })
})
