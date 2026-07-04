/**
 * Unit coverage for the widget entry-point rate limits (Phase 6 R1): under the
 * cap allows, over the cap blocks with a retry-after, and a Redis error fails
 * open. The redis-rate-bucket primitive is mocked so this pins only the policy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { incrementBuckets, bucketRetryAfter } = vi.hoisted(() => ({
  incrementBuckets: vi.fn(),
  bucketRetryAfter: vi.fn().mockResolvedValue(42),
}))
vi.mock('@/lib/server/utils/redis-rate-bucket', () => ({ incrementBuckets, bucketRetryAfter }))

import { checkAnonMintRateLimit, checkWidgetIdentifyRateLimit } from '../widget-rate-limit'

beforeEach(() => vi.clearAllMocks())

describe('widget rate limits', () => {
  it('allows a mint under the cap', async () => {
    incrementBuckets.mockResolvedValue([5])
    expect(await checkAnonMintRateLimit('1.2.3.4')).toEqual({ allowed: true })
  })

  it('blocks a mint over the cap with a retry-after', async () => {
    incrementBuckets.mockResolvedValue([101]) // cap is 100
    expect(await checkAnonMintRateLimit('1.2.3.4')).toEqual({ allowed: false, retryAfter: 42 })
  })

  it('fails open when Redis errors (null count)', async () => {
    incrementBuckets.mockResolvedValue([null])
    expect(await checkAnonMintRateLimit('1.2.3.4')).toEqual({ allowed: true })
  })

  it('bounds identify per IP', async () => {
    incrementBuckets.mockResolvedValue([60])
    expect(await checkWidgetIdentifyRateLimit('1.2.3.4')).toEqual({ allowed: true }) // at cap
    incrementBuckets.mockResolvedValue([61])
    expect(await checkWidgetIdentifyRateLimit('1.2.3.4')).toEqual({
      allowed: false,
      retryAfter: 42,
    })
  })
})
