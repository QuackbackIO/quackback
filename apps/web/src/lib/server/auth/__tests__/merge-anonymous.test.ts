import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, UserId } from '@quackback/ids'

// ── Mock DB ────────────────────────────────────────────────────────────
// Track all operations in order so we can verify the merge sequence
const operations: string[] = []

const mockSelectWhere = vi.fn()
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }))
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }))

const mockDeleteWhere = vi.fn()
const mockDelete = vi.fn((_table?: unknown) => ({ where: mockDeleteWhere }))

const mockUpdateWhere = vi.fn()
const mockUpdateSet = vi.fn((_values?: unknown) => ({ where: mockUpdateWhere }))
const mockUpdate = vi.fn((_table?: unknown) => ({ set: mockUpdateSet }))

// The transaction function just calls the callback with itself (same API)
const mockTx = {
  select: (..._args: unknown[]) => {
    mockSelect()
    return { from: mockSelectFrom }
  },
  delete: (table: { __name?: string }) => {
    operations.push(`delete:${table.__name || 'unknown'}`)
    mockDelete(table)
    return { where: mockDeleteWhere }
  },
  update: (table: { __name?: string }) => {
    operations.push(`update:${table.__name || 'unknown'}`)
    mockUpdate(table)
    return { set: mockUpdateSet }
  },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTransaction = vi.fn(async (fn: any) => fn(mockTx))

vi.mock('@/lib/server/db', () => ({
  db: {
    transaction: (fn: unknown) => mockTransaction(fn),
  },
  votes: { principalId: 'principalId', postId: 'postId', __name: 'votes' },
  comments: { principalId: 'principalId', id: 'id', __name: 'comments' },
  posts: { principalId: 'principalId', __name: 'posts' },
  postSubscriptions: { principalId: 'principalId', postId: 'postId', __name: 'postSubscriptions' },
  inAppNotifications: {
    principalId: 'principalId',
    commentId: 'commentId',
    title: 'title',
    __name: 'inAppNotifications',
  },
  principal: { id: 'id', userId: 'userId', __name: 'principal' },
  session: { userId: 'userId', __name: 'session' },
  user: { id: 'id', __name: 'user' },
  eq: vi.fn((...args: unknown[]) => ({ _type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ _type: 'and', args })),
  inArray: vi.fn((...args: unknown[]) => ({ _type: 'inArray', args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ _type: 'sql', strings, values }),
    { raw: (s: string) => ({ _type: 'sql_raw', value: s }) }
  ),
}))

import { mergeAnonymousToIdentified } from '../merge-anonymous'

describe('mergeAnonymousToIdentified', () => {
  const ANON_PRINCIPAL_ID = 'principal_anon' as PrincipalId
  const TARGET_PRINCIPAL_ID = 'principal_target' as PrincipalId
  const ANON_USER_ID = 'user_anon' as UserId

  const defaultParams = {
    anonPrincipalId: ANON_PRINCIPAL_ID,
    targetPrincipalId: TARGET_PRINCIPAL_ID,
    anonUserId: ANON_USER_ID,
    anonDisplayName: 'Curious Penguin',
    targetDisplayName: 'Jane Doe',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    operations.length = 0
    // Default: no existing votes, no comments, no subscriptions
    mockSelectWhere.mockResolvedValue([])
    mockDeleteWhere.mockResolvedValue(undefined)
    mockUpdateWhere.mockResolvedValue(undefined)
  })

  it('runs the merge inside a database transaction', async () => {
    await mergeAnonymousToIdentified(defaultParams)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('transfers votes from anonymous to target principal', async () => {
    await mergeAnonymousToIdentified(defaultParams)

    // Should update votes table
    expect(operations).toContain('update:votes')
  })

  it('deletes conflicting votes before transfer', async () => {
    // Target user already voted on post_1
    mockSelectWhere.mockResolvedValueOnce([{ postId: 'post_1' }])

    await mergeAnonymousToIdentified(defaultParams)

    // Should delete conflicting anon votes before updating
    const voteOps = operations.filter((op) => op.includes('votes'))
    expect(voteOps).toEqual(['delete:votes', 'update:votes'])
  })

  it('skips conflict deletion when target has no existing votes', async () => {
    // No existing votes for target
    mockSelectWhere.mockResolvedValueOnce([])

    await mergeAnonymousToIdentified(defaultParams)

    // The first votes operation should be update (no delete needed)
    const firstVoteOp = operations.find((op) => op.includes('votes'))
    expect(firstVoteOp).toBe('update:votes')
  })

  it('transfers comments from anonymous to target principal', async () => {
    await mergeAnonymousToIdentified(defaultParams)
    expect(operations).toContain('update:comments')
  })

  it('transfers posts from anonymous to target principal', async () => {
    await mergeAnonymousToIdentified(defaultParams)
    expect(operations).toContain('update:posts')
  })

  it('transfers post subscriptions with conflict handling', async () => {
    // Target already subscribed to post_2
    mockSelectWhere
      .mockResolvedValueOnce([]) // votes query
      .mockResolvedValueOnce([]) // comments query
      .mockResolvedValueOnce([{ postId: 'post_2' }]) // subscriptions query

    await mergeAnonymousToIdentified(defaultParams)

    const subOps = operations.filter((op) => op.includes('postSubscriptions'))
    // Should delete conflicting subs, then update remaining
    expect(subOps).toEqual(['delete:postSubscriptions', 'update:postSubscriptions'])
  })

  it('transfers in-app notifications', async () => {
    await mergeAnonymousToIdentified(defaultParams)
    expect(operations).toContain('update:inAppNotifications')
  })

  it('deletes self-notifications for transferred comments', async () => {
    // Anonymous user has comments
    mockSelectWhere
      .mockResolvedValueOnce([]) // votes query
      .mockResolvedValueOnce([{ id: 'comment_1' }, { id: 'comment_2' }]) // comments query

    await mergeAnonymousToIdentified(defaultParams)

    // Should delete self-notifications (where recipient = target principal + commentId in anon comments)
    const notifOps = operations.filter((op) => op.includes('inAppNotifications'))
    // delete self-notifs, update titles, update principalId
    expect(
      notifOps.filter((op) => op === 'delete:inAppNotifications').length
    ).toBeGreaterThanOrEqual(1)
  })

  it('cleans up anonymous principal, sessions, and user', async () => {
    await mergeAnonymousToIdentified(defaultParams)

    expect(operations).toContain('delete:principal')
    expect(operations).toContain('delete:session')
    expect(operations).toContain('delete:user')
  })

  it('deletes principal before sessions and user', async () => {
    await mergeAnonymousToIdentified(defaultParams)

    const principalIdx = operations.indexOf('delete:principal')
    const sessionIdx = operations.indexOf('delete:session')
    const userIdx = operations.indexOf('delete:user')

    // Principal must be deleted first (it references userId)
    expect(principalIdx).toBeLessThan(sessionIdx)
    expect(principalIdx).toBeLessThan(userIdx)
  })

  it('handles anonymous user with no activity gracefully', async () => {
    // All queries return empty
    mockSelectWhere.mockResolvedValue([])

    await mergeAnonymousToIdentified(defaultParams)

    // Should still clean up the anonymous records
    expect(operations).toContain('delete:principal')
    expect(operations).toContain('delete:session')
    expect(operations).toContain('delete:user')
  })
})
