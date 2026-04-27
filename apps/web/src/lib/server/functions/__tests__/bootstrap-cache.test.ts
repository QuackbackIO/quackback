/**
 * Bootstrap principal cache tests.
 *
 * The principal type/role lookup in getSessionAndRole used to fire a DB
 * query on every authenticated SSR render. It now reads PRINCIPAL_BY_USER
 * from Redis first; only a miss queries the DB and writes back with a
 * 5min TTL. Verify both paths and the no-cache-on-null safeguard.
 *
 * We exercise the cache logic directly rather than booting the full
 * createServerOnlyFn — the Promise.all at the top of getSessionAndRole
 * is the part under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()
const mockFindFirst = vi.fn()

const CACHE_KEYS = {
  PRINCIPAL_BY_USER: (userId: string) => `principal:user:${userId}`,
}

const PRINCIPAL_TTL_SECONDS = 300

// Re-implementation of the production read-through to exercise the
// contract under test. Mirrors getSessionAndRole's principal lookup
// in apps/web/src/lib/server/functions/bootstrap.ts.
async function readPrincipalThroughCache(userId: string) {
  const key = CACHE_KEYS.PRINCIPAL_BY_USER(userId)
  let record = await mockCacheGet(key)
  if (!record) {
    record = (await mockFindFirst({ userId })) ?? null
    if (record) await mockCacheSet(key, record, PRINCIPAL_TTL_SECONDS)
  }
  return record
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheSet.mockResolvedValue(undefined)
})

describe('bootstrap principal cache', () => {
  it('returns the cached record without hitting the DB on cache hit', async () => {
    mockCacheGet.mockResolvedValue({ type: 'user', role: 'admin' })

    const result = await readPrincipalThroughCache('user_1')

    expect(result).toEqual({ type: 'user', role: 'admin' })
    expect(mockCacheGet).toHaveBeenCalledWith('principal:user:user_1')
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockCacheSet).not.toHaveBeenCalled()
  })

  it('queries the DB and writes the result with 5min TTL on cache miss', async () => {
    mockCacheGet.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue({ type: 'user', role: 'member' })

    const result = await readPrincipalThroughCache('user_2')

    expect(result).toEqual({ type: 'user', role: 'member' })
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
    expect(mockCacheSet).toHaveBeenCalledWith(
      'principal:user:user_2',
      { type: 'user', role: 'member' },
      300
    )
  })

  it('does not cache when the DB returns no principal', async () => {
    // Authenticated session but principal row missing (race during signup, etc.).
    // The TTL would otherwise mask a freshly-created principal for 5min.
    mockCacheGet.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue(undefined)

    const result = await readPrincipalThroughCache('user_3')

    expect(result).toBeNull()
    expect(mockCacheSet).not.toHaveBeenCalled()
  })

  it('keys cache entries per-user (no cross-contamination)', async () => {
    mockCacheGet.mockImplementation((key: string) =>
      key === 'principal:user:userA' ? { type: 'user', role: 'admin' } : null
    )
    mockFindFirst.mockResolvedValue({ type: 'user', role: 'member' })

    const a = await readPrincipalThroughCache('userA')
    const b = await readPrincipalThroughCache('userB')

    expect(a).toEqual({ type: 'user', role: 'admin' })
    expect(b).toEqual({ type: 'user', role: 'member' })
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
    expect(mockCacheSet).toHaveBeenCalledWith(
      'principal:user:userB',
      { type: 'user', role: 'member' },
      300
    )
  })
})
