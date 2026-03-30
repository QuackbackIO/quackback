import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock createServerFn to just return the handler directly
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
    handler: (fn: (...args: unknown[]) => unknown) => fn,
  }),
}))

// Mock auth
const mockRequireAuth = vi.fn()
vi.mock('../auth-helpers', () => ({
  requireAuth: () => mockRequireAuth(),
}))

// Track DB query calls
const mockQueryResults: Array<Promise<{ count: number }[]>> = []

vi.mock('@/lib/server/db', () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => mockQueryResults.shift() ?? Promise.resolve([{ count: 0 }]),
        }),
      }),
    },
    posts: { principalId: 'principalId', deletedAt: 'deletedAt' },
    votes: { principalId: 'principalId' },
    comments: { principalId: 'principalId', deletedAt: 'deletedAt' },
    user: {},
    principal: {},
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    count: vi.fn(() => 'count()'),
  }
})

vi.mock('@quackback/ids', () => ({ generateId: vi.fn() }))
vi.mock('./auth', () => ({ getSession: vi.fn() }))
vi.mock('./workspace', () => ({ getCurrentUserRole: vi.fn() }))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  syncPrincipalProfile: vi.fn(),
}))
vi.mock('@/lib/server/storage/s3', () => ({ deleteObject: vi.fn() }))
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}))

import { getUserStatsFn, type UserEngagementStats } from '../user'

describe('getUserStatsFn', () => {
  const PRINCIPAL_ID = 'principal_test123'

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryResults.length = 0
    mockRequireAuth.mockResolvedValue({
      principal: { id: PRINCIPAL_ID },
      user: { id: 'user_123' },
    })
  })

  it('returns counts for ideas, votes, and comments', async () => {
    mockQueryResults.push(
      Promise.resolve([{ count: 5 }]),
      Promise.resolve([{ count: 42 }]),
      Promise.resolve([{ count: 8 }])
    )

    const result: UserEngagementStats = await getUserStatsFn()

    expect(result).toEqual({ ideas: 5, votes: 42, comments: 8 })
  })

  it('returns zeros when user has no activity', async () => {
    mockQueryResults.push(
      Promise.resolve([{ count: 0 }]),
      Promise.resolve([{ count: 0 }]),
      Promise.resolve([{ count: 0 }])
    )

    const result = await getUserStatsFn()

    expect(result).toEqual({ ideas: 0, votes: 0, comments: 0 })
  })

  it('throws when user is not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Unauthorized'))

    await expect(getUserStatsFn()).rejects.toThrow('Unauthorized')
  })

  it('defaults to zero when count result is empty', async () => {
    mockQueryResults.push(Promise.resolve([]), Promise.resolve([]), Promise.resolve([]))

    const result = await getUserStatsFn()

    expect(result).toEqual({ ideas: 0, votes: 0, comments: 0 })
  })
})
