/**
 * Principal cache invalidation tests.
 *
 * Verifies that updateMemberRole and removeTeamMember invalidate the
 * PRINCIPAL_BY_USER cache so the SSR bootstrap sees role changes
 * without waiting for the 5min TTL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, UserId } from '@quackback/ids'

const mockCacheDel = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheDel: (...args: unknown[]) => mockCacheDel(...args),
  CACHE_KEYS: {
    PRINCIPAL_BY_USER: (userId: string) => `principal:user:${userId}`,
  },
}))

const mockFindFirst = vi.fn()
const mockSelect = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { principal: { findFirst: (...a: unknown[]) => mockFindFirst(...a) } },
    select: (...a: unknown[]) => mockSelect(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
  // Drizzle helpers / table identifiers — only need to be defined, not functional.
  eq: vi.fn(),
  ne: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(() => ({ as: vi.fn() })),
  ilike: vi.fn(),
  principal: { id: 'id', userId: 'userId', role: 'role', type: 'type' },
  user: {},
}))

const { updateMemberRole, removeTeamMember } = await import('../principal.service')

const ACTING = 'principal_acting' as PrincipalId
const TARGET = 'principal_target' as PrincipalId
const TARGET_USER = 'user_target' as UserId

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheDel.mockResolvedValue(undefined)

  // db.update(principal).set(...).where(...) chain — terminates as a Promise.
  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  })

  // Both LAST_ADMIN guards in updateMemberRole + removeTeamMember run
  // db.select({count}).from(principal).where(...). Return count=2 so the
  // guards pass and the mutation proceeds.
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ count: 2 }]) }),
  })
})

describe('updateMemberRole', () => {
  it('invalidates PRINCIPAL_BY_USER for the target user after role change', async () => {
    mockFindFirst.mockResolvedValue({
      id: TARGET,
      userId: TARGET_USER,
      type: 'user',
      role: 'admin',
    })

    await updateMemberRole(TARGET, 'member', ACTING)

    expect(mockCacheDel).toHaveBeenCalledWith(`principal:user:${TARGET_USER}`)
  })

  it('does not call cacheDel when the target principal has no userId', async () => {
    // Service principals (API keys) have userId=null; nothing to invalidate.
    mockFindFirst.mockResolvedValue({
      id: TARGET,
      userId: null,
      type: 'service',
      role: 'admin',
    })

    await updateMemberRole(TARGET, 'member', ACTING)

    expect(mockCacheDel).not.toHaveBeenCalled()
  })
})

describe('removeTeamMember', () => {
  it('invalidates PRINCIPAL_BY_USER for the target user after removal', async () => {
    mockFindFirst.mockResolvedValue({
      id: TARGET,
      userId: TARGET_USER,
      type: 'user',
      role: 'member',
    })

    await removeTeamMember(TARGET, ACTING)

    expect(mockCacheDel).toHaveBeenCalledWith(`principal:user:${TARGET_USER}`)
  })
})
