import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock: capture handlers registered via createServerFn ---

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
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
  policyActorFromAuth: vi.fn(async () => ({ principalId: 'principal_me' })),
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: vi.fn(async () => ({ granted: true })),
}))
vi.mock('@/lib/server/domains/posts/post.access', () => ({
  assertPostViewable: vi.fn(async () => undefined),
}))

// --- Mock: subscription service ---

const mockSubscribeToPost = vi.fn()
const mockUnsubscribeFromPost = vi.fn()
const mockUpdateSubscriptionLevel = vi.fn()

const mockGetSubscriptionStatus = vi.fn()
const mockAnnounce = vi.fn()
vi.mock('@/lib/server/domains/posts/post.subscribers', () => ({
  announcePostSubscriberChange: (...args: unknown[]) => mockAnnounce(...args),
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getSubscriptionStatus: (...args: unknown[]) => mockGetSubscriptionStatus(...args),
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
  postVotes: { id: 'id', postId: 'postId', principalId: 'principalId' },
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}))

vi.mock('@/lib/server/domains/posts/post.merge-ids', () => ({
  relatedPostIdsSubquery: vi.fn(() => 'related-post-ids'),
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
    mockLimit.mockResolvedValue([{ id: 'vote_1', postId: 'post_abc123' }])

    await handler({ data: validData })

    // subscribeToPost should receive level in options (4th arg)
    expect(mockSubscribeToPost).toHaveBeenCalledWith('principal_xyz456', 'post_abc123', 'manual', {
      level: 'status_only',
    })
  })

  it('calls unsubscribeFromPost for level "none" when voter exists', async () => {
    mockRequireAuth.mockResolvedValue({ principalId: 'admin_principal' })
    mockLimit.mockResolvedValue([{ id: 'vote_1', postId: 'post_abc123' }])

    await handler({ data: { ...validData, level: 'none' } })

    expect(mockUnsubscribeFromPost).toHaveBeenCalledWith('principal_xyz456', 'post_abc123')
    expect(mockSubscribeToPost).not.toHaveBeenCalled()
  })

  it('calls both subscribeToPost and updateSubscriptionLevel for non-none levels', async () => {
    mockRequireAuth.mockResolvedValue({ principalId: 'admin_principal' })
    mockLimit.mockResolvedValue([{ id: 'vote_1', postId: 'post_abc123' }])

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

  it('writes the subscription on the vote post when the voter is only on a merged source', async () => {
    mockRequireAuth.mockResolvedValue({ principalId: 'admin_principal' })
    mockLimit.mockResolvedValue([{ id: 'vote_1', postId: 'post_source' }])

    await handler({ data: validData })

    expect(mockSubscribeToPost).toHaveBeenCalledWith('principal_xyz456', 'post_source', 'manual', {
      level: 'status_only',
    })
    expect(mockUpdateSubscriptionLevel).toHaveBeenCalledWith(
      'principal_xyz456',
      'post_source',
      'status_only'
    )
  })

  it('returns the updated subscription data on success', async () => {
    mockRequireAuth.mockResolvedValue({ principalId: 'admin_principal' })
    mockLimit.mockResolvedValue([{ id: 'vote_1', postId: 'post_abc123' }])

    const result = await handler({ data: validData })

    expect(result).toEqual({
      postId: 'post_abc123',
      principalId: 'principal_xyz456',
      level: 'status_only',
    })
  })
})

describe('following a post by hand', () => {
  const me = { principal: { id: 'principal_me' } }

  it('announces a new follow once, and nothing for a repeat', async () => {
    mockRequireAuth.mockResolvedValue(me)
    mockSubscribeToPost.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await handlersByIndex[1]({ data: { postId: 'post_abc123', level: 'all' } })
    await handlersByIndex[1]({ data: { postId: 'post_abc123', level: 'all' } })
    expect(mockAnnounce).toHaveBeenCalledTimes(1)
    expect(mockAnnounce).toHaveBeenCalledWith(
      'added',
      { principalId: 'principal_me' },
      'post_abc123',
      'principal_me',
      'manual'
    )
  })

  it('announces an unfollow with the reason the follow had', async () => {
    mockRequireAuth.mockResolvedValue(me)
    mockGetSubscriptionStatus.mockResolvedValueOnce({ subscribed: true, reason: 'vote' })
    await handlersByIndex[2]({ data: { postId: 'post_abc123' } })
    expect(mockAnnounce).toHaveBeenCalledWith(
      'removed',
      expect.anything(),
      'post_abc123',
      'principal_me',
      'vote'
    )
  })

  it('treats a level change to or from none as an unfollow or a follow', async () => {
    mockRequireAuth.mockResolvedValue(me)
    mockGetSubscriptionStatus.mockResolvedValueOnce({ subscribed: false, reason: null })
    await handlersByIndex[3]({ data: { postId: 'post_abc123', level: 'status_only' } })
    expect(mockAnnounce).toHaveBeenLastCalledWith(
      'added',
      expect.anything(),
      'post_abc123',
      'principal_me',
      'manual'
    )
    mockGetSubscriptionStatus.mockResolvedValueOnce({ subscribed: true, reason: 'manual' })
    await handlersByIndex[3]({ data: { postId: 'post_abc123', level: 'all' } })
    expect(mockAnnounce).toHaveBeenCalledTimes(1)
    mockGetSubscriptionStatus.mockResolvedValueOnce({ subscribed: true, reason: 'manual' })
    await handlersByIndex[3]({ data: { postId: 'post_abc123', level: 'none' } })
    expect(mockAnnounce).toHaveBeenLastCalledWith(
      'removed',
      expect.anything(),
      'post_abc123',
      'principal_me',
      'manual'
    )
  })
})

describe('subscribeToPostFn', () => {
  it('always records a self subscription as manual, whatever reason the client sends', async () => {
    mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_me' } })
    await handlersByIndex[1]({ data: { postId: 'post_abc123', reason: 'author', level: 'all' } })
    expect(mockSubscribeToPost).toHaveBeenCalledWith('principal_me', 'post_abc123', 'manual', {
      level: 'all',
    })
  })
})
