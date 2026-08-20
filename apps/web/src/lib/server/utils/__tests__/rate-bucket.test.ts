/**
 * The rate-bucket wrapper's contract with its callers: pass counts through, and
 * **fail open** when the store is unreachable.
 *
 * The window arithmetic, the atomicity of the increment and the tenant
 * discriminator are properties of the statement, and live in
 * `kv/__tests__/pg-kv-semantics.db.test.ts` against a real server. What this
 * file pins is the wrapper — specifically the direction of its failure, because
 * getting that backwards locks every user out of sign-in during an outage
 * instead of letting them in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('@/lib/server/kv/pg-kv', () => ({
  incrementRateBucket: hoisted.one,
  incrementRateBuckets: hoisted.many,
  rateBucketRetryAfter: hoisted.retry,
}))

const { incrementBucket, incrementBuckets, bucketRetryAfter } = await import('../rate-bucket')

beforeEach(() => vi.clearAllMocks())

describe('incrementBucket', () => {
  it('returns the post-increment count', async () => {
    hoisted.one.mockResolvedValueOnce({ count: 7, retryAfterSeconds: 30 })
    expect(await incrementBucket({ key: 'k', windowSeconds: 60 })).toEqual({ count: 7 })
    expect(hoisted.one).toHaveBeenCalledWith({ key: 'k', windowSeconds: 60 })
  })

  it('fails OPEN with a null count when the store throws', async () => {
    hoisted.one.mockRejectedValueOnce(new Error('database unreachable'))
    expect(await incrementBucket({ key: 'k', windowSeconds: 60 })).toEqual({ count: null })
  })
})

describe('incrementBuckets', () => {
  it('returns counts in input order', async () => {
    hoisted.many.mockResolvedValueOnce([
      { count: 3, retryAfterSeconds: 10 },
      { count: 1, retryAfterSeconds: 10 },
    ])
    expect(
      await incrementBuckets([
        { key: 'a', windowSeconds: 60 },
        { key: 'b', windowSeconds: 60 },
      ])
    ).toEqual([3, 1])
  })

  it('short-circuits an empty list without a round trip', async () => {
    expect(await incrementBuckets([])).toEqual([])
    expect(hoisted.many).not.toHaveBeenCalled()
  })

  it('fails OPEN with one null per spec when the store throws', async () => {
    hoisted.many.mockRejectedValueOnce(new Error('database unreachable'))
    expect(
      await incrementBuckets([
        { key: 'a', windowSeconds: 60 },
        { key: 'b', windowSeconds: 60 },
      ])
    ).toEqual([null, null])
  })
})

describe('bucketRetryAfter', () => {
  it('passes the store’s answer through', async () => {
    hoisted.retry.mockResolvedValueOnce(42)
    expect(await bucketRetryAfter({ key: 'k', windowSeconds: 60 })).toBe(42)
  })

  it('falls back to the window size when the store throws', async () => {
    hoisted.retry.mockRejectedValueOnce(new Error('database unreachable'))
    expect(await bucketRetryAfter({ key: 'k', windowSeconds: 60 })).toBe(60)
  })
})
