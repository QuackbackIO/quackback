/**
 * Differential-coverage tests for the shared queue Redis helpers — lazy
 * singleton creation, the connection-option wrapper, and the graceful close
 * (including the quit-failure disconnect fallback).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  ctor: vi.fn(),
  quit: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(),
}))

vi.mock('ioredis', () => ({
  default: class {
    quit = m.quit
    disconnect = m.disconnect
    constructor(...a: unknown[]) {
      m.ctor(...a)
    }
  },
}))
vi.mock('@/lib/server/config', () => ({ config: { redisUrl: 'redis://localhost:6379' } }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  m.quit.mockResolvedValue(undefined)
})

const load = () => import('../redis-config')

describe('queue redis helpers', () => {
  it('creates the shared client once and reuses it', async () => {
    const { getQueueRedis, getQueueConnection } = await load()
    const a = getQueueRedis()
    const b = getQueueRedis()
    expect(a).toBe(b)
    expect(m.ctor).toHaveBeenCalledTimes(1)
    expect(getQueueConnection()).toEqual({ connection: a })
  })

  it('closeQueueRedis is a no-op before any connection exists', async () => {
    const { closeQueueRedis } = await load()
    await closeQueueRedis()
    expect(m.quit).not.toHaveBeenCalled()
  })

  it('quits the client on close', async () => {
    const { getQueueRedis, closeQueueRedis } = await load()
    getQueueRedis()
    await closeQueueRedis()
    expect(m.quit).toHaveBeenCalledTimes(1)
    expect(m.disconnect).not.toHaveBeenCalled()
  })

  it('force-disconnects when quit rejects', async () => {
    m.quit.mockRejectedValueOnce(new Error('race'))
    const { getQueueRedis, closeQueueRedis } = await load()
    getQueueRedis()
    await closeQueueRedis()
    expect(m.disconnect).toHaveBeenCalledTimes(1)
  })
})
