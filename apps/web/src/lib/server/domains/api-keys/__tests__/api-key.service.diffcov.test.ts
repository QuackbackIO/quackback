/**
 * Differential-coverage tests for api-key.service — the toApiKey default
 * fill-ins (null scopes/allowlists), validateScopes empty-entry skip, and the
 * updateApiKey / acknowledgeLegacyCompat validation + not-found branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ apiKeysFindFirst: vi.fn(), updateReturning: vi.fn() }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { apiKeys: { findFirst: m.apiKeysFindFirst } },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: m.updateReturning,
          then: (r: (v: unknown) => void) => r(undefined),
        }),
      }),
    }),
  },
  apiKeys: { id: 'ak.id' },
  principal: { id: 'pr.id' },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@/lib/server/config', () => ({ config: { secretKey: 'test-secret' } }))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  createServicePrincipal: vi.fn(),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchApiKeyCreated: vi.fn(() => Promise.resolve()),
  dispatchApiKeyRotated: vi.fn(() => Promise.resolve()),
  dispatchApiKeyRevoked: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/shared/roles', () => ({ isAdmin: () => false }))
vi.mock('@/lib/server/redis', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (u: string) => `p:${u}` },
}))

import { getApiKeyById, updateApiKey, acknowledgeLegacyCompat } from '../api-key.service'

// A row with null/absent optional fields, to exercise the toApiKey defaults.
const sparseRow = {
  id: 'key_1',
  name: 'CI',
  keyPrefix: 'qb_abc',
  createdById: 'p1',
  principalId: 'sp_1',
  lastUsedAt: null,
  expiresAt: null,
  createdAt: new Date('2026-01-01'),
  revokedAt: null,
  scopes: null,
  allowedTeamIds: null,
  allowedInboxIds: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  m.apiKeysFindFirst.mockResolvedValue(undefined)
  m.updateReturning.mockResolvedValue([sparseRow])
})

describe('getApiKeyById / toApiKey defaults', () => {
  it('throws when missing', async () => {
    await expect(getApiKeyById('key_1' as never)).rejects.toThrow('not found')
  })
  it('fills array/null defaults for absent optional columns', async () => {
    m.apiKeysFindFirst.mockResolvedValueOnce(sparseRow)
    const key = await getApiKeyById('key_1' as never)
    expect(key.scopes).toEqual([])
    expect(key.allowedTeamIds).toEqual([])
    expect(key.allowedInboxIds).toEqual([])
    expect(key.lastIp).toBeNull()
    expect(key.compatLegacyFullAccess).toBe(true)
  })
})

describe('updateApiKey', () => {
  it('rejects an empty / over-long name', async () => {
    await expect(updateApiKey('key_1' as never, { name: ' ' })).rejects.toThrow('name is required')
    await expect(updateApiKey('key_1' as never, { name: 'x'.repeat(256) })).rejects.toThrow(
      '255 characters'
    )
  })
  it('skips blank scope entries (validateScopes) and dedupes allowlists', async () => {
    await updateApiKey('key_1' as never, {
      scopes: ['  '],
      allowedTeamIds: ['team_1', 'team_1'],
      allowedInboxIds: ['inbox_1'],
    })
    expect(m.updateReturning).toHaveBeenCalled()
  })
  it('returns the existing key when the patch is empty', async () => {
    m.apiKeysFindFirst.mockResolvedValueOnce(sparseRow) // getApiKeyById fallback
    const key = await updateApiKey('key_1' as never, {})
    expect(key.id).toBe('key_1')
  })
  it('updates the name and syncs the service principal', async () => {
    m.updateReturning.mockResolvedValueOnce([{ ...sparseRow, name: 'Renamed' }])
    const key = await updateApiKey('key_1' as never, { name: ' Renamed ' })
    expect(key.name).toBe('Renamed')
  })
  it('throws when the update matches no row', async () => {
    m.updateReturning.mockResolvedValueOnce([])
    await expect(updateApiKey('key_1' as never, { allowedTeamIds: ['t'] })).rejects.toThrow(
      'not found'
    )
  })
})

describe('acknowledgeLegacyCompat', () => {
  it('acknowledges and returns the key', async () => {
    const key = await acknowledgeLegacyCompat('key_1' as never)
    expect(key.id).toBe('key_1')
  })
  it('throws when missing', async () => {
    m.updateReturning.mockResolvedValueOnce([])
    await expect(acknowledgeLegacyCompat('key_1' as never)).rejects.toThrow('not found')
  })
})
