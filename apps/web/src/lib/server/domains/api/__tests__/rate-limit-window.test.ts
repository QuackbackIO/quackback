/**
 * The REST rate limit end to end through withApiKeyAuth and the error
 * mapper: with no tier limit, an address gets 100 requests a minute, the
 * 101st is answered 429 RATE_LIMITED with Retry-After, and requests that
 * carry a bad key count toward the same window (journey API-50).
 *
 * The rate-bucket store is an in-memory counter keyed exactly as the real one
 * (by bucket key), so a limiter that keyed by something else, or stopped
 * counting failed keys, would show here. Not an e2e test: the e2e suite's
 * shards share one loopback address.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { counts, peer } = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  peer: { ip: '203.0.113.9' },
}))

vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBuckets: vi.fn(async (buckets: Array<{ key: string }>) =>
    buckets.map((b) => {
      const next = (counts.get(b.key) ?? 0) + 1
      counts.set(b.key, next)
      return next
    })
  ),
  bucketRetryAfter: vi.fn(async () => 42),
  getBucketCount: vi.fn(async (key: string) => counts.get(key) ?? 0),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', async () => {
  const { OSS_TIER_LIMITS } = await import('@/lib/server/domains/settings/tier-limits.types')
  return { getTierLimits: vi.fn(async () => OSS_TIER_LIMITS) }
})

vi.mock('@tanstack/react-start/server', () => ({
  getRequestIP: () => peer.ip,
}))

// Every key presented here is unknown.
vi.mock('@/lib/server/domains/api-keys/api-key.service', () => ({
  verifyApiKey: vi.fn(async () => null),
}))

import { withApiKeyAuth } from '../auth'
import { handleDomainError } from '../responses'
import { RateLimitError, UnauthorizedError } from '@/lib/shared/errors'

function badKeyRequest(): Request {
  return new Request('https://example.com/api/v1/conversations', {
    headers: { authorization: `Bearer qb_${'0'.repeat(48)}` },
  })
}

describe('REST rate limit window', () => {
  beforeEach(() => {
    counts.clear()
    peer.ip = '203.0.113.9'
  })

  it('answers the 101st request in a minute 429 RATE_LIMITED with Retry-After, counting bad keys', async () => {
    // 100 requests with a bad key: each is counted, each is a 401.
    for (let i = 0; i < 100; i++) {
      await expect(withApiKeyAuth(badKeyRequest())).rejects.toBeInstanceOf(UnauthorizedError)
    }
    expect(counts.get('api:rl:203.0.113.9')).toBe(100)

    const error = await withApiKeyAuth(badKeyRequest()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RateLimitError)

    const res = handleDomainError(error)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(await res.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    })
  })

  it('keeps one address in its own window: another address is still served', async () => {
    for (let i = 0; i < 101; i++) await withApiKeyAuth(badKeyRequest()).catch(() => {})
    peer.ip = '198.51.100.7'
    await expect(withApiKeyAuth(badKeyRequest())).rejects.toBeInstanceOf(UnauthorizedError)
  })
})
