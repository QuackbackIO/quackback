/**
 * Rate-limit helpers for sign-in endpoints. Built on the shared
 * `redis-rate-bucket` primitive so the limiter tests focus on policy
 * (thresholds, namespacing, dispatch) rather than re-asserting the
 * Redis plumbing (which has its own tests on the primitive).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIncrementBuckets = vi.fn()
const mockBucketRetryAfter = vi.fn()

vi.mock('@/lib/server/utils/redis-rate-bucket', () => ({
  incrementBuckets: (...args: unknown[]) => mockIncrementBuckets(...args),
  bucketRetryAfter: (...args: unknown[]) => mockBucketRetryAfter(...args),
}))

const { checkCredentialSignInRateLimit, checkMagicLinkSendRateLimit } =
  await import('../signin-rate-limit')

beforeEach(() => {
  vi.clearAllMocks()
  // Default: both buckets at 1 (first attempt).
  mockIncrementBuckets.mockResolvedValue([1, 1])
})

describe('checkCredentialSignInRateLimit', () => {
  it('allows under both bucket caps', async () => {
    const result = await checkCredentialSignInRateLimit('203.0.113.1', 'a@b.com')
    expect(result.allowed).toBe(true)
  })

  it('blocks at count > 5 on the per-(ip+email) bucket', async () => {
    mockIncrementBuckets.mockResolvedValueOnce([6, 1])
    mockBucketRetryAfter.mockResolvedValueOnce(180)
    const result = await checkCredentialSignInRateLimit('203.0.113.1', 'a@b.com')
    expect(result).toEqual({ allowed: false, retryAfter: 180 })
  })

  it('blocks at count > 50 on the per-IP bucket (email-rotation defence)', async () => {
    mockIncrementBuckets.mockResolvedValueOnce([1, 51])
    mockBucketRetryAfter.mockResolvedValueOnce(600)
    const result = await checkCredentialSignInRateLimit('203.0.113.1', 'new@b.com')
    expect(result).toEqual({ allowed: false, retryAfter: 600 })
  })

  it('issues one merged pipeline call with both bucket specs', async () => {
    await checkCredentialSignInRateLimit('203.0.113.1', 'a@b.com')
    expect(mockIncrementBuckets).toHaveBeenCalledTimes(1)
    const specs = mockIncrementBuckets.mock.calls[0][0] as Array<{
      key: string
      windowSeconds: number
    }>
    expect(specs).toEqual([
      { key: 'signin:credential:203.0.113.1:a@b.com', windowSeconds: 300 },
      { key: 'signin:credential:ip:203.0.113.1', windowSeconds: 900 },
    ])
  })

  it('fails open when the pipeline reports a Redis error (null counts)', async () => {
    mockIncrementBuckets.mockResolvedValueOnce([null, null])
    const result = await checkCredentialSignInRateLimit('203.0.113.1', 'a@b.com')
    expect(result.allowed).toBe(true)
  })
})

describe('checkMagicLinkSendRateLimit', () => {
  it('blocks at count > 3 on the per-(ip+email) bucket (email-spam defence)', async () => {
    mockIncrementBuckets.mockResolvedValueOnce([4, 1])
    mockBucketRetryAfter.mockResolvedValueOnce(800)
    const result = await checkMagicLinkSendRateLimit('203.0.113.1', 'a@b.com')
    expect(result).toEqual({ allowed: false, retryAfter: 800 })
  })

  it('blocks at count > 20 on the per-IP bucket', async () => {
    mockIncrementBuckets.mockResolvedValueOnce([1, 21])
    mockBucketRetryAfter.mockResolvedValueOnce(600)
    const result = await checkMagicLinkSendRateLimit('203.0.113.1', 'new@b.com')
    expect(result).toEqual({ allowed: false, retryAfter: 600 })
  })

  it('uses 15-minute windows and a separate namespace from credential', async () => {
    await checkMagicLinkSendRateLimit('203.0.113.1', 'a@b.com')
    const specs = mockIncrementBuckets.mock.calls[0][0] as Array<{
      key: string
      windowSeconds: number
    }>
    expect(specs).toEqual([
      { key: 'signin:magiclink:203.0.113.1:a@b.com', windowSeconds: 900 },
      { key: 'signin:magiclink:ip:203.0.113.1', windowSeconds: 900 },
    ])
  })

  it('fails open when the pipeline reports a Redis error', async () => {
    mockIncrementBuckets.mockResolvedValueOnce([null, null])
    const result = await checkMagicLinkSendRateLimit('203.0.113.1', 'a@b.com')
    expect(result.allowed).toBe(true)
  })
})
