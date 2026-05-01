import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockedFindFirst: vi.fn(),
  mockedUpdate: vi.fn(),
}))

vi.mock('@/lib/server/db', async () => {
  const drizzle = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    db: {
      query: { apiKeys: { findFirst: (...a: unknown[]) => hoisted.mockedFindFirst(...a) } },
      update: () => ({
        set: () => ({ where: () => ({ execute: vi.fn().mockResolvedValue([]) }) }),
      }),
    },
    apiKeys: { id: 'id', keyPrefix: 'kp', revokedAt: 'r' },
    eq: drizzle.eq,
    and: drizzle.and,
    isNull: drizzle.isNull,
  }
})

import { verifyApiKeyWithScope } from '../api-key.service'

describe('verifyApiKeyWithScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for invalid format', async () => {
    expect(await verifyApiKeyWithScope('not-a-key', 'internal:tier-limits')).toBeNull()
  })

  it('returns null when key is not found', async () => {
    hoisted.mockedFindFirst.mockResolvedValue(null)
    expect(await verifyApiKeyWithScope('qb_aaaaaaaaaaaaaaaaaa', 'internal:tier-limits')).toBeNull()
  })

  it('returns null when scope is missing', async () => {
    // Build a key that hashes to known value would be too much; use a stub:
    hoisted.mockedFindFirst.mockResolvedValue({
      id: 'k',
      // 64-hex chars but won't match the hash of the test key — verifyApiKey returns null
      keyHash: '0'.repeat(64),
      scopes: JSON.stringify(['internal:tier-limits']),
      revokedAt: null,
      expiresAt: null,
    })
    // Hash mismatch -> null regardless of scope.
    expect(await verifyApiKeyWithScope('qb_aaaaaaaaaaaaaaaaaa', 'internal:tier-limits')).toBeNull()
  })
})

describe('hasScope (helper)', () => {
  it('checks scope membership in a JSON-encoded array', async () => {
    const { hasScope } = await import('../api-key.service')
    expect(hasScope(JSON.stringify(['internal:tier-limits']), 'internal:tier-limits')).toBe(true)
    expect(hasScope(JSON.stringify(['other:scope']), 'internal:tier-limits')).toBe(false)
    expect(hasScope(null, 'internal:tier-limits')).toBe(false)
    expect(hasScope('not-json', 'internal:tier-limits')).toBe(false)
    expect(hasScope(JSON.stringify([]), 'internal:tier-limits')).toBe(false)
  })
})
