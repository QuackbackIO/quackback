import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

const mockIncrementBucket = vi.fn()
const mockBucketRetryAfter = vi.fn()

vi.mock('@/lib/server/utils/redis-rate-bucket', () => ({
  incrementBucket: (...args: unknown[]) => mockIncrementBucket(...args),
  bucketRetryAfter: (...args: unknown[]) => mockBucketRetryAfter(...args),
}))

import { checkRateLimit } from '../rate-limit'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('checkRateLimit — tier-aware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses apiRequestsPerMinute from tier when set', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, apiRequestsPerMinute: 5 })
    mockIncrementBucket.mockResolvedValueOnce({ count: 5 })
    const allowed = await checkRateLimit('1.1.1.1')
    expect(allowed).toEqual({ allowed: true, remaining: 0 })

    mockIncrementBucket.mockResolvedValueOnce({ count: 6 })
    mockBucketRetryAfter.mockResolvedValueOnce(60)
    const blocked = await checkRateLimit('1.1.1.1')
    expect(blocked).toEqual({ allowed: false, remaining: 0, retryAfter: 60 })
  })

  it('falls back to OSS default cap when tier limit is null', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    mockIncrementBucket.mockResolvedValueOnce({ count: 100 })
    const allowed = await checkRateLimit('2.2.2.2')
    expect(allowed).toEqual({ allowed: true, remaining: 0 })

    mockIncrementBucket.mockResolvedValueOnce({ count: 101 })
    mockBucketRetryAfter.mockResolvedValueOnce(60)
    const blocked = await checkRateLimit('2.2.2.2')
    expect(blocked).toEqual({ allowed: false, remaining: 0, retryAfter: 60 })
  })

  it('uses a shared per-IP key regardless of import mode', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    mockIncrementBucket.mockResolvedValueOnce({ count: 1 })
    await checkRateLimit('3.3.3.3', true)
    expect(mockIncrementBucket).toHaveBeenCalledWith({
      key: 'api:rl:3.3.3.3',
      windowSeconds: 60,
    })
  })

  it('applies the import-mode multiplier with a 2000 floor', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, apiRequestsPerMinute: 5 })
    mockIncrementBucket.mockResolvedValueOnce({ count: 2000 })
    const result = await checkRateLimit('4.4.4.4', true)
    expect(result).toEqual({ allowed: true, remaining: 0 })
  })

  it('fails open when the primitive reports a Redis error (null count)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    mockIncrementBucket.mockResolvedValueOnce({ count: null })
    const result = await checkRateLimit('5.5.5.5')
    expect(result).toEqual({ allowed: true, remaining: 100 })
  })
})
