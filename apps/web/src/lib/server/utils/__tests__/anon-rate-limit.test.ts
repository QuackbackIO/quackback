import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db
const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockInnerJoin = vi.fn()
const mockWhere = vi.fn()

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  const chain = {
    from: (...args: unknown[]) => {
      mockFrom(...args)
      return chain
    },
    innerJoin: (...args: unknown[]) => {
      mockInnerJoin(...args)
      return chain
    },
    where: (...args: unknown[]) => mockWhere(...args),
  }

  return {
    db: {
      select: (...args: unknown[]) => {
        mockSelect(...args)
        return chain
      },
    },
    principal: { id: 'principal_id', type: 'type', userId: 'user_id' },
    session: { userId: 'user_id', ipAddress: 'ip_address', createdAt: 'created_at' },
    eq: vi.fn(),
    and: vi.fn(),
    sql: realSql,
  }
})

import { checkAnonVoteRateLimit } from '../anon-rate-limit'

describe('checkAnonVoteRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when session count is under the limit', async () => {
    mockWhere.mockResolvedValue([{ count: 10 }])

    const result = await checkAnonVoteRateLimit('1.2.3.4')
    expect(result).toBe(true)
  })

  it('returns true when session count is zero', async () => {
    mockWhere.mockResolvedValue([{ count: 0 }])

    const result = await checkAnonVoteRateLimit('1.2.3.4')
    expect(result).toBe(true)
  })

  it('returns false when session count reaches the limit (50)', async () => {
    mockWhere.mockResolvedValue([{ count: 50 }])

    const result = await checkAnonVoteRateLimit('1.2.3.4')
    expect(result).toBe(false)
  })

  it('returns false when session count exceeds the limit', async () => {
    mockWhere.mockResolvedValue([{ count: 100 }])

    const result = await checkAnonVoteRateLimit('1.2.3.4')
    expect(result).toBe(false)
  })

  it('returns true when result is null/undefined', async () => {
    mockWhere.mockResolvedValue([{ count: null }])

    const result = await checkAnonVoteRateLimit('0.0.0.0')
    expect(result).toBe(true)
  })

  it('returns true at count 49 (just under limit)', async () => {
    mockWhere.mockResolvedValue([{ count: 49 }])

    const result = await checkAnonVoteRateLimit('10.0.0.1')
    expect(result).toBe(true)
  })
})
