/**
 * `computeVisitorHash` and the UTC day key are pure; the salt's store behaviour
 * is pinned here only for its failure direction (a store outage must return
 * null so the caller DROPS the event rather than persisting a key derived from
 * raw identifiers).
 *
 * Salt uniqueness per workspace, the get-or-create race and the 48h expiry are
 * properties of the statement and of the heap cache together, and live in
 * `visitor-hash-workspace-isolation.db.test.ts` against a real server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({ getOrCreate: vi.fn() }))

vi.mock('@/lib/server/kv/pg-kv', () => ({ kvGetOrCreate: hoisted.getOrCreate }))

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
  it('asks the store for the day-keyed salt with a 48h TTL, and returns what it gets', async () => {
    // The winner of a concurrent race may not be this caller, so the value
    // returned is the store's, never the freshly minted one.
    hoisted.getOrCreate.mockResolvedValueOnce('stored-salt')

    const salt = await getDailySalt(new Date('2026-07-01T10:00:00Z'))

    expect(salt).toBe('stored-salt')
    expect(hoisted.getOrCreate).toHaveBeenCalledWith(
      'visitor:salt:2026-07-01',
      expect.any(String),
      48 * 60 * 60
    )
  })

  it('returns null when the store is unavailable (caller drops the event)', async () => {
    hoisted.getOrCreate.mockRejectedValueOnce(new Error('down'))

    expect(await getDailySalt(new Date('2026-09-09T10:00:00Z'))).toBeNull()
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
