/**
 * Differential-coverage tests for the analytics queue worker — job processing,
 * the redis-ready timeout catch, the `failed` handler branches, and the
 * init-promise singleton (reuse + reset on failure).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  add: vi.fn(() => Promise.resolve()),
  waitUntilReady: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  refreshAnalytics: vi.fn(() => Promise.resolve()),
  error: vi.fn(),
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
  logger: { child: () => ({ error: m.error, info: vi.fn() }) },
}))
vi.mock('../analytics.service', () => ({ refreshAnalytics: m.refreshAnalytics }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  m.waitUntilReady.mockResolvedValue(undefined)
  m.processor = undefined
  m.failed = undefined
})

async function load() {
  return await import('../analytics-queue')
}

describe('analytics queue', () => {
  it('initializes and processes a refresh job (and ignores other types)', async () => {
    const { initAnalyticsWorker } = await load()
    await initAnalyticsWorker()
    expect(m.add).toHaveBeenCalled()
    await m.processor!({ data: { type: 'refresh-analytics' } })
    expect(m.refreshAnalytics).toHaveBeenCalledTimes(1)
    await m.processor!({ data: { type: 'other' } })
    expect(m.refreshAnalytics).toHaveBeenCalledTimes(1)
  })

  it('reuses the init promise on a second call', async () => {
    const { initAnalyticsWorker } = await load()
    await initAnalyticsWorker()
    await initAnalyticsWorker()
    // Queue created once → add called once across both init calls
    expect(m.add).toHaveBeenCalledTimes(1)
  })

  it('logs permanent vs transient failures and ignores a null job', async () => {
    const { initAnalyticsWorker } = await load()
    await initAnalyticsWorker()
    m.failed!(null, new Error('x'))
    m.failed!({ attemptsMade: 3, opts: { attempts: 3 }, data: {} }, new Error('boom'))
    m.failed!(
      { attemptsMade: 1, opts: { attempts: 3 }, data: {} },
      Object.assign(new Error('u'), { name: 'UnrecoverableError' })
    )
    m.failed!({ attemptsMade: 1, opts: {}, data: {} }, new Error('soft'))
    expect(m.error).toHaveBeenCalledTimes(3)
  })

  it('closes the queue and rethrows when redis never becomes ready', async () => {
    m.waitUntilReady.mockRejectedValueOnce(new Error('redis down'))
    const { initAnalyticsWorker } = await load()
    await expect(initAnalyticsWorker()).rejects.toThrow('redis down')
    expect(m.close).toHaveBeenCalled()
  })
})
