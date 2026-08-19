import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsFeatureEnabled = vi.fn()
const mockGetHelpCenterConfig = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  getHelpCenterConfig: (...args: unknown[]) => mockGetHelpCenterConfig(...args),
}))

const mockHybridSearch = vi.fn()
vi.mock('@/lib/server/domains/help-center/help-center-search.service', () => ({
  hybridSearchForLocale: (query: string, _locale: string, limit: number) =>
    mockHybridSearch(query, limit),
  resolveSearchLocale: (
    requested: string | undefined,
    enabled: string[],
    defaultLocale: string
  ) => (requested && enabled.includes(requested) ? requested : defaultLocale),
}))

const mockIncrementBucket = vi.fn()
const mockBucketRetryAfter = vi.fn()
vi.mock('@/lib/server/utils/redis-rate-bucket', () => ({
  incrementBucket: (...args: unknown[]) => mockIncrementBucket(...args),
  bucketRetryAfter: (...args: unknown[]) => mockBucketRetryAfter(...args),
}))

import { handleKbSearch, KB_SEARCH_RATE_LIMIT } from '../kb-search'

function makeRequest(q?: string, ip = '203.0.113.9'): Request {
  const url = new URL('http://localhost/api/widget/kb-search')
  if (q !== undefined) url.searchParams.set('q', q)
  return new Request(url, { headers: { 'x-forwarded-for': ip } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockGetHelpCenterConfig.mockResolvedValue({ locales: { additional: [], default: 'en' } })
  mockIncrementBucket.mockResolvedValue({ count: 1 })
  mockBucketRetryAfter.mockResolvedValue(30)
  mockHybridSearch.mockResolvedValue([])
})

describe('GET /api/widget/kb-search rate limiting', () => {
  it('404s when the help center flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const res = await handleKbSearch({ request: makeRequest('hello') })
    expect(res.status).toBe(404)
  })

  it('searches normally under the limit', async () => {
    const res = await handleKbSearch({ request: makeRequest('hello') })
    expect(res.status).toBe(200)
    expect(mockHybridSearch).toHaveBeenCalledWith('hello', 10)
  })

  it('429s with Retry-After when over the per-IP limit', async () => {
    mockIncrementBucket.mockResolvedValue({ count: KB_SEARCH_RATE_LIMIT + 1 })
    const res = await handleKbSearch({ request: makeRequest('hello') })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(mockHybridSearch).not.toHaveBeenCalled()
  })

  it('fails open when Redis errors', async () => {
    mockIncrementBucket.mockResolvedValue({ count: null })
    const res = await handleKbSearch({ request: makeRequest('hello') })
    expect(res.status).toBe(200)
  })

  it('does not consume rate budget for empty queries', async () => {
    const res = await handleKbSearch({ request: makeRequest() })
    expect(res.status).toBe(200)
    expect(mockIncrementBucket).not.toHaveBeenCalled()
  })
})
