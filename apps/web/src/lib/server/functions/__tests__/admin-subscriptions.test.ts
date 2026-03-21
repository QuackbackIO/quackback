import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock: capture handlers registered via createServerFn ---

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

// --- Mock: auth helpers ---

const mockRequireAuth = vi.fn()

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

// --- Mock: subscription service ---

const mockSubscribeToPost = vi.fn()
const mockUnsubscribeFromPost = vi.fn()
const mockUpdateSubscriptionLevel = vi.fn()

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getSubscriptionStatus: vi.fn(),
  subscribeToPost: (...args: unknown[]) => mockSubscribeToPost(...args),
  unsubscribeFromPost: (...args: unknown[]) => mockUnsubscribeFromPost(...args),
  updateSubscriptionLevel: (...args: unknown[]) => mockUpdateSubscriptionLevel(...args),
  processUnsubscribeToken: vi.fn(),
}))

// --- Mock: db (for vote existence check) ---

const mockLimit = vi.fn()
const mockWhere = vi.fn(() => ({ limit: mockLimit }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))
const mockSelect = vi.fn(() => ({ from: mockFrom }))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => mockSelect(),
  },
  votes: { id: 'id', postId: 'postId', principalId: 'principalId' },
  eq: vi.fn(),
  and: vi.fn(),
}))

// --- Handler setup ---

// Handler indices match declaration order in subscriptions.ts:
// 0: fetchSubscriptionStatus, 1: subscribeToPostFn, 2: unsubscribeFromPostFn,
// 3: updateSubscriptionLevelFn, 4: adminUpdateVoterSubscriptionFn,
// 5: processUnsubscribeTokenFn
const HANDLER_INDEX = 4

let handler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../subscriptions')
  }
  handler = handlersByIndex[HANDLER_INDEX]
})

describe('adminUpdateVoterSubscriptionFn', () => {
  const validData = {
    postId: 'post_abc123',
    principalId: 'principal_xyz456',
    level: 'status_only',
  }

  it('rejects requests for non-voters', async () => {
    mockRequireAuth.mockResolvedValue({ principalId: 'admin_principal' })
    // Vote query returns empty array (no vote found)
    mockLimit.mockResolvedValue([])

    await expect(handler({ data: validData })).rejects.toThrow(
      'Principal does not have a vote on this post'
    )

    // Should NOT have called any subscription functions
    expect(mockSubscribeToPost).not.toHaveBeenCalled()
    expect(mockUnsubscribeFromPost).not.toHaveBeenCalled()
    expect(mockUpdateSubscriptionLevel).not.toHaveBeenCalled()
  })

  it('passes the requested level to subscribeToPost to avoid intermediate state', async () => {
    mockRequireAuth.mockResolvedValue({ principalId: 'admin_principal' })
    // Vote exists
    mockLimit.mockResolvedValue([{ id: 'vote_1' }])

    await handler({ data: validData })

    // subscribeToPost should receive level in options (4th arg)
    expect(mockSubscribeToPost).toHaveBeenCalledWith('principal_xyz456', 'post_abc123', 'manual', {
      level: 'status_only',
    })
  })

  it('calls unsubscribeFromPost for level "none" when voter exists', async () => {
    mockRequireAuth.mockResolvedValue({ principalId: 'admin_principal' })
    mockLimit.mockResolvedValue([{ id: 'vote_1' }])

    await handler({ data: { ...validData, level: 'none' } })

    expect(mockUnsubscribeFromPost).toHaveBeenCalledWith('principal_xyz456', 'post_abc123')
    expect(mockSubscribeToPost).not.toHaveBeenCalled()
  })

  it('calls both subscribeToPost and updateSubscriptionLevel for non-none levels', async () => {
    mockRequireAuth.mockResolvedValue({ principalId: 'admin_principal' })
    mockLimit.mockResolvedValue([{ id: 'vote_1' }])

    await handler({ data: { ...validData, level: 'all' } })

    expect(mockSubscribeToPost).toHaveBeenCalledWith('principal_xyz456', 'post_abc123', 'manual', {
      level: 'all',
    })
    expect(mockUpdateSubscriptionLevel).toHaveBeenCalledWith(
      'principal_xyz456',
      'post_abc123',
      'all'
    )
  })

  it('returns the updated subscription data on success', async () => {
    mockRequireAuth.mockResolvedValue({ principalId: 'admin_principal' })
    mockLimit.mockResolvedValue([{ id: 'vote_1' }])

    const result = await handler({ data: validData })

    expect(result).toEqual({
      postId: 'post_abc123',
      principalId: 'principal_xyz456',
      level: 'status_only',
    })
  })
})
