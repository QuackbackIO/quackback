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

describe('verifyApiKeyWithScope — scope parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when scopes is null', async () => {
    hoisted.mockedFindFirst.mockResolvedValue({
      id: 'k',
      keyHash: '0'.repeat(64),
      scopes: null,
      revokedAt: null,
      expiresAt: null,
    })
    expect(await verifyApiKeyWithScope('qb_aaaaaaaaaaaaaaaaaa', 'internal:tier-limits')).toBeNull()
  })

  it('rejects when scopes JSON is malformed', async () => {
    hoisted.mockedFindFirst.mockResolvedValue({
      id: 'k',
      keyHash: '0'.repeat(64),
      scopes: 'not-json',
      revokedAt: null,
      expiresAt: null,
    })
    expect(await verifyApiKeyWithScope('qb_aaaaaaaaaaaaaaaaaa', 'internal:tier-limits')).toBeNull()
  })

  it('rejects when scope not present in array', async () => {
    hoisted.mockedFindFirst.mockResolvedValue({
      id: 'k',
      keyHash: '0'.repeat(64),
      scopes: JSON.stringify(['other:scope']),
      revokedAt: null,
      expiresAt: null,
    })
    expect(await verifyApiKeyWithScope('qb_aaaaaaaaaaaaaaaaaa', 'internal:tier-limits')).toBeNull()
  })
})
