/**
 * Cache helper tests (cacheGet, cacheSet, cacheDel)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockDel = vi.fn()

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      get = mockGet
      set = mockSet
      del = mockDel
      on() {
        return this
      }
    },
  }
})

vi.mock('@/lib/server/config', () => ({
  config: { redisUrl: 'redis://localhost:6379' },
}))

// Import after mocks
const { cacheGet, cacheSet, cacheDel, CACHE_KEYS } = await import('../redis')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CACHE_KEYS', () => {
  it('exports expected cache key constants', () => {
    expect(CACHE_KEYS.TENANT_SETTINGS).toBe('settings:tenant')
    expect(CACHE_KEYS.INTEGRATION_MAPPINGS).toBe('hooks:integration-mappings')
    expect(CACHE_KEYS.ACTIVE_WEBHOOKS).toBe('hooks:webhooks-active')
    expect(CACHE_KEYS.SLACK_CHANNELS).toBe('slack:channels')
  })
})

describe('cacheGet', () => {
  it('returns parsed JSON when key exists', async () => {
    const data = { name: 'test', count: 42 }
    mockGet.mockResolvedValue(JSON.stringify(data))

    const result = await cacheGet<typeof data>('my-key')

    expect(mockGet).toHaveBeenCalledWith('my-key')
    expect(result).toEqual(data)
  })

  it('returns null when key does not exist', async () => {
    mockGet.mockResolvedValue(null)

    const result = await cacheGet('missing-key')

    expect(result).toBeNull()
  })

  it('returns null on Redis error (non-fatal)', async () => {
    mockGet.mockRejectedValue(new Error('connection refused'))

    const result = await cacheGet('error-key')

    expect(result).toBeNull()
  })

  it('handles arrays', async () => {
    const data = [{ id: 1 }, { id: 2 }]
    mockGet.mockResolvedValue(JSON.stringify(data))

    const result = await cacheGet<typeof data>('array-key')

    expect(result).toEqual(data)
  })
})

describe('cacheSet', () => {
  it('serializes value and sets with TTL', async () => {
    mockSet.mockResolvedValue('OK')
    const data = { name: 'test' }

    await cacheSet('my-key', data, 300)

    expect(mockSet).toHaveBeenCalledWith('my-key', JSON.stringify(data), 'EX', 300)
  })

  it('swallows Redis errors (non-fatal)', async () => {
    mockSet.mockRejectedValue(new Error('connection refused'))

    // Should not throw
    await expect(cacheSet('key', 'value', 60)).resolves.toBeUndefined()
  })
})

describe('cacheDel', () => {
  it('deletes a single key', async () => {
    mockDel.mockResolvedValue(1)

    await cacheDel('my-key')

    expect(mockDel).toHaveBeenCalledWith('my-key')
  })

  it('deletes multiple keys at once', async () => {
    mockDel.mockResolvedValue(2)

    await cacheDel('key-a', 'key-b')

    expect(mockDel).toHaveBeenCalledWith('key-a', 'key-b')
  })

  it('swallows Redis errors (non-fatal)', async () => {
    mockDel.mockRejectedValue(new Error('connection refused'))

    await expect(cacheDel('key')).resolves.toBeUndefined()
  })
})
