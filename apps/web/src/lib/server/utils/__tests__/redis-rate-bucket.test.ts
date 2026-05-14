/**
 * Tests for the Redis fixed-window rate-bucket primitive — INCR +
 * EXPIRE NX in a single pipeline, fail-open on errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExec = vi.fn()
const mockTtl = vi.fn()
const mockMulti = vi.fn(() => ({
  incr: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: mockExec,
}))

vi.mock('@/lib/server/redis', () => ({
  getRedis: () => ({ multi: mockMulti, ttl: mockTtl }),
}))

const { incrementBucket, incrementBuckets, bucketRetryAfter } = await import('../redis-rate-bucket')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('incrementBucket', () => {
  it('returns the post-INCR count from the pipeline reply', async () => {
    mockExec.mockResolvedValueOnce([
      [null, 7],
      [null, 1],
    ])
    const result = await incrementBucket({ key: 'k', windowSeconds: 60 })
    expect(result.count).toBe(7)
  })

  it('issues INCR and EXPIRE NX with the right args', async () => {
    mockExec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ])
    await incrementBucket({ key: 'foo', windowSeconds: 300 })
    const pipeline = mockMulti.mock.results[0]!.value as {
      incr: ReturnType<typeof vi.fn>
      expire: ReturnType<typeof vi.fn>
    }
    expect(pipeline.incr).toHaveBeenCalledWith('foo')
    expect(pipeline.expire).toHaveBeenCalledWith('foo', 300, 'NX')
  })

  it('returns count=null on Redis error (fail-open signal)', async () => {
    mockExec.mockRejectedValueOnce(new Error('redis down'))
    const result = await incrementBucket({ key: 'k', windowSeconds: 60 })
    expect(result.count).toBeNull()
  })
})

describe('incrementBuckets', () => {
  it('batches multiple specs into one pipeline + returns counts in order', async () => {
    mockExec.mockResolvedValueOnce([
      [null, 3],
      [null, 1],
      [null, 11],
      [null, 0],
    ])
    const counts = await incrementBuckets([
      { key: 'a', windowSeconds: 60 },
      { key: 'b', windowSeconds: 900 },
    ])
    expect(counts).toEqual([3, 11])
    expect(mockMulti).toHaveBeenCalledTimes(1)
  })

  it('returns null entries on Redis error', async () => {
    mockExec.mockRejectedValueOnce(new Error('redis down'))
    const counts = await incrementBuckets([
      { key: 'a', windowSeconds: 60 },
      { key: 'b', windowSeconds: 60 },
    ])
    expect(counts).toEqual([null, null])
  })

  it('returns an empty array for zero specs (no pipeline call)', async () => {
    const counts = await incrementBuckets([])
    expect(counts).toEqual([])
    expect(mockMulti).not.toHaveBeenCalled()
  })
})

describe('bucketRetryAfter', () => {
  it('returns the live TTL when positive', async () => {
    mockTtl.mockResolvedValueOnce(123)
    const after = await bucketRetryAfter({ key: 'k', windowSeconds: 300 })
    expect(after).toBe(123)
  })

  it('falls back to window size when Redis reports -1 (no TTL)', async () => {
    mockTtl.mockResolvedValueOnce(-1)
    const after = await bucketRetryAfter({ key: 'k', windowSeconds: 300 })
    expect(after).toBe(300)
  })

  it('falls back to window size on Redis error', async () => {
    mockTtl.mockRejectedValueOnce(new Error('redis down'))
    const after = await bucketRetryAfter({ key: 'k', windowSeconds: 60 })
    expect(after).toBe(60)
  })
})
