import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSet = vi.fn()
const mockGet = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  getRedis: () => ({
    set: mockSet,
    get: mockGet,
  }),
}))

const { utcDateKey, getDailySalt, computeVisitorHash } = await import('../visitor-hash')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('utcDateKey', () => {
  it('formats the UTC calendar date', () => {
    expect(utcDateKey(new Date('2026-07-01T15:30:00Z'))).toBe('2026-07-01')
  })

  it('buckets by UTC, not local time', () => {
    // 23:30 UTC is already the next day in UTC+2, but the key stays UTC.
    expect(utcDateKey(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-01')
  })
})

describe('getDailySalt', () => {
  it('creates the salt with NX + 48h TTL and returns the stored value', async () => {
    mockSet.mockResolvedValue(null) // another writer won the race
    mockGet.mockResolvedValue('stored-salt')

    const salt = await getDailySalt(new Date('2026-07-01T10:00:00Z'))

    expect(salt).toBe('stored-salt')
    expect(mockSet).toHaveBeenCalledWith(
      'visitor:salt:2026-07-01',
      expect.any(String),
      'EX',
      48 * 60 * 60,
      'NX'
    )
    expect(mockGet).toHaveBeenCalledWith('visitor:salt:2026-07-01')
  })

  it('returns null when Redis is unavailable (caller drops the event)', async () => {
    mockSet.mockRejectedValue(new Error('down'))

    expect(await getDailySalt()).toBeNull()
  })
})

describe('computeVisitorHash', () => {
  const base = {
    salt: 's1',
    siteOrigin: 'https://feedback.example.com',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
  }

  it('is deterministic for identical inputs', () => {
    expect(computeVisitorHash(base)).toBe(computeVisitorHash({ ...base }))
  })

  it('produces a 64-char hex digest', () => {
    expect(computeVisitorHash(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when any component changes', () => {
    const reference = computeVisitorHash(base)
    expect(computeVisitorHash({ ...base, salt: 's2' })).not.toBe(reference)
    expect(computeVisitorHash({ ...base, siteOrigin: 'https://other.example.com' })).not.toBe(
      reference
    )
    expect(computeVisitorHash({ ...base, ip: '203.0.113.8' })).not.toBe(reference)
    expect(computeVisitorHash({ ...base, userAgent: 'curl/8' })).not.toBe(reference)
  })

  it('is not vulnerable to component-boundary ambiguity', () => {
    // "ab" + "c" must not collide with "a" + "bc" across field boundaries.
    const a = computeVisitorHash({ ...base, siteOrigin: 'https://x.com/a', ip: 'b1' })
    const b = computeVisitorHash({ ...base, siteOrigin: 'https://x.com/', ip: 'ab1' })
    expect(a).not.toBe(b)
  })
})
