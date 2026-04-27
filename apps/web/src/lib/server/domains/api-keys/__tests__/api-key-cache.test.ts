/**
 * API key cache invalidation tests.
 *
 * revokeApiKey downgrades the service principal's role to 'user' and
 * must invalidate PRINCIPAL_BY_USER so any active SSR session for that
 * service principal sees the demotion immediately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiKeyId } from '@quackback/ids'

const mockCacheDel = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheDel: (...args: unknown[]) => mockCacheDel(...args),
  CACHE_KEYS: {
    PRINCIPAL_BY_USER: (userId: string) => `principal:user:${userId}`,
  },
}))

const mockUpdate = vi.fn()
const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    update: (...a: unknown[]) => mockUpdate(...a),
    query: { principal: { findFirst: (...a: unknown[]) => mockFindFirst(...a) } },
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  apiKeys: { id: 'id', revokedAt: 'revokedAt' },
  principal: { id: 'id' },
}))

const { revokeApiKey } = await import('../api-key.service')

const KEY = 'apikey_xyz' as ApiKeyId

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheDel.mockResolvedValue(undefined)
})

describe('revokeApiKey cache invalidation', () => {
  it('invalidates PRINCIPAL_BY_USER for the service principal owner', async () => {
    // First update() chain: update(apiKeys).set(...).where(...).returning() →
    // returns the revoked row including its principalId.
    mockUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue([{ id: KEY, principalId: 'principal_svc', revokedAt: new Date() }]),
        }),
      }),
    })
    // Second update() chain: update(principal).set({role:'user'}).where(...).
    mockUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })

    mockFindFirst.mockResolvedValue({ userId: 'user_svc_owner' })

    await revokeApiKey(KEY)

    expect(mockCacheDel).toHaveBeenCalledWith('principal:user:user_svc_owner')
  })

  it('skips invalidation when the principal has no userId (pure service principal)', async () => {
    mockUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue([{ id: KEY, principalId: 'principal_svc', revokedAt: new Date() }]),
        }),
      }),
    })
    mockUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })

    mockFindFirst.mockResolvedValue({ userId: null })

    await revokeApiKey(KEY)

    expect(mockCacheDel).not.toHaveBeenCalled()
  })
})
