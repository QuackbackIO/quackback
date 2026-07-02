/**
 * Differential-coverage tests for subscription.service — subscribe/unsubscribe,
 * level updates, status, subscriber/preference queries (with default fallbacks),
 * unsubscribe-token generation, and the token-processing branch matrix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  selectWhere: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  onConflict: vi.fn(),
  deleteWhere: vi.fn(),
  setWhere: vi.fn(),
  subsFindFirst: vi.fn(),
  prefsFindFirst: vi.fn(),
  tokensFindFirst: vi.fn(),
  principalFindFirst: vi.fn(),
  postsFindFirst: vi.fn(),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn() }) },
}))

vi.mock('@/lib/server/db', () => {
  const selectChain: Record<string, unknown> = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => m.selectWhere(),
  }
  const valuesResult = {
    onConflictDoNothing: (...a: unknown[]) => m.onConflict(...a),
    returning: () => m.insertReturning(),
    then: (r: (v: unknown) => void) => r(undefined),
  }
  const setWhereResult = {
    returning: () => m.updateReturning(),
    then: (r: (v: unknown) => void) => r(m.setWhere()),
  }
  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => ({ values: () => valuesResult })),
      update: vi.fn(() => ({ set: () => ({ where: () => setWhereResult }) })),
      delete: vi.fn(() => ({ where: (...a: unknown[]) => m.deleteWhere(...a) })),
      query: {
        postSubscriptions: { findFirst: m.subsFindFirst },
        notificationPreferences: { findFirst: m.prefsFindFirst },
        unsubscribeTokens: { findFirst: m.tokensFindFirst },
        principal: { findFirst: m.principalFindFirst },
        posts: { findFirst: m.postsFindFirst },
      },
    },
    eq: vi.fn((a, b) => ({ eq: [a, b] })),
    and: vi.fn((...a) => ({ and: a })),
    inArray: vi.fn((a, b) => ({ inArray: [a, b] })),
    isNull: vi.fn((a) => ({ isNull: a })),
    isNotNull: vi.fn((a) => ({ isNotNull: a })),
    postSubscriptions: {
      id: 'ps.id',
      principalId: 'ps.principalId',
      postId: 'ps.postId',
      notifyComments: 'ps.nc',
      notifyStatusChanges: 'ps.ns',
      reason: 'ps.reason',
      createdAt: 'ps.createdAt',
    },
    notificationPreferences: { principalId: 'np.principalId', emailStatusChange: 'np.esc' },
    unsubscribeTokens: { token: 'ut.token', id: 'ut.id' },
    posts: { id: 'posts.id', title: 'posts.title', deletedAt: 'posts.deletedAt' },
    principal: { id: 'principal.id', userId: 'principal.userId' },
    user: { id: 'user.id', email: 'user.email', name: 'user.name' },
  }
})

import * as svc from '../subscription.service'

const pid = 'principal_1' as never
const postId = 'post_1' as never

beforeEach(() => {
  vi.clearAllMocks()
  m.selectWhere.mockResolvedValue([])
  m.onConflict.mockResolvedValue(undefined)
  m.deleteWhere.mockResolvedValue(undefined)
  m.setWhere.mockReturnValue(undefined)
  m.insertReturning.mockResolvedValue([{ emailStatusChange: true }])
  m.updateReturning.mockResolvedValue([{ emailStatusChange: false }])
})

describe('subscribe/unsubscribe/level', () => {
  it('subscribes with the default level (all)', async () => {
    await svc.subscribeToPost(pid, postId, 'authored' as never)
    expect(m.onConflict).toHaveBeenCalled()
  })

  it('subscribes status_only within a provided transaction', async () => {
    const tx = { insert: vi.fn(() => ({ values: () => ({ onConflictDoNothing: m.onConflict }) })) }
    await svc.subscribeToPost(pid, postId, 'authored' as never, {
      tx: tx as never,
      level: 'status_only',
    })
    expect(tx.insert).toHaveBeenCalled()
  })

  it('unsubscribes', async () => {
    await svc.unsubscribeFromPost(pid, postId)
    expect(m.deleteWhere).toHaveBeenCalled()
  })

  it('updateSubscriptionLevel none delegates to unsubscribe', async () => {
    await svc.updateSubscriptionLevel(pid, postId, 'none' as never)
    expect(m.deleteWhere).toHaveBeenCalled()
  })

  it('updateSubscriptionLevel all updates flags', async () => {
    await svc.updateSubscriptionLevel(pid, postId, 'all' as never)
    expect(m.deleteWhere).not.toHaveBeenCalled()
  })
})

describe('getSubscriptionStatus', () => {
  it('returns unsubscribed defaults when no row', async () => {
    m.subsFindFirst.mockResolvedValueOnce(undefined)
    const s = await svc.getSubscriptionStatus(pid, postId)
    expect(s).toMatchObject({ subscribed: false, level: 'none' })
  })

  it('maps an existing subscription', async () => {
    m.subsFindFirst.mockResolvedValueOnce({
      notifyComments: true,
      notifyStatusChanges: true,
      reason: 'authored',
    })
    const s = await svc.getSubscriptionStatus(pid, postId)
    expect(s.subscribed).toBe(true)
  })
})

describe('subscriber + subscription queries', () => {
  it('getSubscribersForEvent filters out null emails (comment)', async () => {
    m.selectWhere.mockResolvedValueOnce([
      {
        principalId: 'p1',
        userId: 'u1',
        email: 'a@x.test',
        name: 'A',
        reason: 'authored',
        notifyComments: true,
        notifyStatusChanges: true,
      },
      {
        principalId: 'p2',
        userId: 'u2',
        email: null,
        name: 'B',
        reason: 'authored',
        notifyComments: true,
        notifyStatusChanges: false,
      },
    ])
    const subs = await svc.getSubscribersForEvent(postId, 'comment')
    expect(subs).toHaveLength(1)
    expect(subs[0].email).toBe('a@x.test')
  })

  it('getSubscribersForEvent uses the status column', async () => {
    await svc.getSubscribersForEvent(postId, 'status_change')
    expect(m.selectWhere).toHaveBeenCalled()
  })

  it('getMemberSubscriptions maps rows', async () => {
    m.selectWhere.mockResolvedValueOnce([
      {
        id: 's1',
        postId,
        postTitle: 'T',
        reason: 'authored',
        notifyComments: true,
        notifyStatusChanges: true,
        createdAt: new Date(),
      },
    ])
    const subs = await svc.getMemberSubscriptions(pid)
    expect(subs[0].id).toBe('s1')
  })
})

describe('notification preferences', () => {
  it('returns stored preferences', async () => {
    m.prefsFindFirst.mockResolvedValueOnce({
      emailStatusChange: false,
      emailNewComment: false,
      emailMuted: true,
      emailTicketThreads: false,
      emailTicketProperties: false,
      emailTicketStatus: false,
      emailTicketAssignment: false,
      emailTicketParticipants: true,
      emailTicketShares: true,
      emailTicketSla: false,
    })
    const p = await svc.getNotificationPreferences(pid)
    expect(p.emailMuted).toBe(true)
  })

  it('returns defaults when none exist', async () => {
    m.prefsFindFirst.mockResolvedValueOnce(undefined)
    const p = await svc.getNotificationPreferences(pid)
    expect(p.emailStatusChange).toBe(true)
  })

  it('batchGet returns an empty map for no ids', async () => {
    expect((await svc.batchGetNotificationPreferences([])).size).toBe(0)
  })

  it('batchGet fills defaults for missing ids', async () => {
    m.selectWhere.mockResolvedValueOnce([
      {
        principalId: 'p1',
        emailStatusChange: false,
        emailNewComment: true,
        emailMuted: false,
        emailTicketThreads: true,
        emailTicketProperties: true,
        emailTicketStatus: true,
        emailTicketAssignment: true,
        emailTicketParticipants: false,
        emailTicketShares: false,
        emailTicketSla: true,
      },
    ])
    const map = await svc.batchGetNotificationPreferences(['p1', 'p2'] as never)
    expect(map.get('p1' as never)?.emailStatusChange).toBe(false)
    expect(map.get('p2' as never)?.emailStatusChange).toBe(true) // default
  })

  it('updateNotificationPreferences updates an existing row', async () => {
    m.prefsFindFirst.mockResolvedValueOnce({ principalId: 'p1' })
    m.updateReturning.mockResolvedValueOnce([
      {
        emailStatusChange: false,
        emailNewComment: false,
        emailMuted: false,
        emailTicketThreads: false,
        emailTicketProperties: false,
        emailTicketStatus: false,
        emailTicketAssignment: false,
        emailTicketParticipants: false,
        emailTicketShares: false,
        emailTicketSla: false,
      },
    ])
    const p = await svc.updateNotificationPreferences(pid, { emailMuted: false })
    expect(p.emailStatusChange).toBe(false)
  })

  it('updateNotificationPreferences inserts defaults when none exists', async () => {
    m.prefsFindFirst.mockResolvedValueOnce(undefined)
    m.insertReturning.mockResolvedValueOnce([
      {
        emailStatusChange: true,
        emailNewComment: true,
        emailMuted: false,
        emailTicketThreads: true,
        emailTicketProperties: true,
        emailTicketStatus: true,
        emailTicketAssignment: true,
        emailTicketParticipants: false,
        emailTicketShares: false,
        emailTicketSla: true,
      },
    ])
    const p = await svc.updateNotificationPreferences(pid, {})
    expect(p.emailNewComment).toBe(true)
  })
})

describe('unsubscribe tokens', () => {
  it('generates a token', async () => {
    const t = await svc.generateUnsubscribeToken(pid, postId, 'unsubscribe_post')
    expect(typeof t).toBe('string')
  })

  it('batch generate returns empty for no entries', async () => {
    expect((await svc.batchGenerateUnsubscribeTokens([])).size).toBe(0)
  })

  it('batch generate returns a token per principal', async () => {
    const map = await svc.batchGenerateUnsubscribeTokens([
      { principalId: 'p1' as never, postId, action: 'unsubscribe_post' },
    ])
    expect(map.size).toBe(1)
  })
})

describe('processUnsubscribeToken', () => {
  const future = new Date(Date.now() + 1000000)
  it('returns null for an unknown token', async () => {
    m.tokensFindFirst.mockResolvedValueOnce(undefined)
    expect(await svc.processUnsubscribeToken('x')).toBeNull()
  })

  it('returns null for a used token', async () => {
    m.tokensFindFirst.mockResolvedValueOnce({ usedAt: new Date() })
    expect(await svc.processUnsubscribeToken('x')).toBeNull()
  })

  it('returns null for an expired token', async () => {
    m.tokensFindFirst.mockResolvedValueOnce({ usedAt: null, expiresAt: new Date(0) })
    expect(await svc.processUnsubscribeToken('x')).toBeNull()
  })

  it('returns null when the principal is gone', async () => {
    m.tokensFindFirst.mockResolvedValueOnce({
      usedAt: null,
      expiresAt: future,
      id: 'tok',
      principalId: 'p1',
      postId: null,
      action: 'unsubscribe_all',
    })
    m.principalFindFirst.mockResolvedValueOnce(undefined)
    expect(await svc.processUnsubscribeToken('x')).toBeNull()
  })

  it('processes unsubscribe_post with post details', async () => {
    m.tokensFindFirst.mockResolvedValueOnce({
      usedAt: null,
      expiresAt: future,
      id: 'tok',
      principalId: 'p1',
      postId,
      action: 'unsubscribe_post',
    })
    m.principalFindFirst.mockResolvedValueOnce({ id: 'p1' })
    m.postsFindFirst.mockResolvedValueOnce({ title: 'T', board: { slug: 'b' } })
    const res = await svc.processUnsubscribeToken('x')
    expect(res).toMatchObject({ action: 'unsubscribe_post', post: { title: 'T', boardSlug: 'b' } })
  })

  it('processes unsubscribe_all (no post)', async () => {
    m.tokensFindFirst.mockResolvedValueOnce({
      usedAt: null,
      expiresAt: future,
      id: 'tok',
      principalId: 'p1',
      postId: null,
      action: 'unsubscribe_all',
    })
    m.principalFindFirst.mockResolvedValueOnce({ id: 'p1' })
    m.prefsFindFirst.mockResolvedValueOnce({ principalId: 'p1' })
    const res = await svc.processUnsubscribeToken('x')
    expect(res?.action).toBe('unsubscribe_all')
  })
})
