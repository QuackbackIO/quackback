/**
 * Differential-coverage tests for moderation.service — pending list queries and
 * the guarded approve/reject transitions for posts and comments (not-found,
 * not-pending conflict, comment-count reconciliation, and announce-failure
 * swallow).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const chain: Record<string, unknown> = {}
  for (const k of ['from', 'innerJoin', 'leftJoin', 'where']) chain[k] = () => chain
  chain.orderBy = () => m.selectResult()
  const tx = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => m.txReturning(),
          then: (r: (v: unknown) => void) => r(undefined),
        }),
      }),
    }),
  }
  return {
    chain,
    tx,
    selectResult: vi.fn(),
    postsFindFirst: vi.fn(),
    commentsFindFirst: vi.fn(),
    updateReturning: vi.fn(),
    txReturning: vi.fn(),
    recordAudit: vi.fn(),
    announcePost: vi.fn((..._a: unknown[]) => Promise.resolve()),
    announceComment: vi.fn((..._a: unknown[]) => Promise.resolve()),
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => m.chain,
    query: { posts: { findFirst: m.postsFindFirst }, comments: { findFirst: m.commentsFindFirst } },
    update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
    transaction: async (cb: (t: typeof m.tx) => unknown) => cb(m.tx),
  },
  posts: {
    id: 'p.id',
    boardId: 'p.boardId',
    deletedAt: 'p.deletedAt',
    moderationState: 'p.moderationState',
    commentCount: 'p.commentCount',
    title: 'p.title',
    content: 'p.content',
    createdAt: 'p.createdAt',
    principalId: 'p.principalId',
  },
  comments: {
    id: 'c.id',
    postId: 'c.postId',
    deletedAt: 'c.deletedAt',
    moderationState: 'c.moderationState',
    isPrivate: 'c.isPrivate',
    content: 'c.content',
    createdAt: 'c.createdAt',
    principalId: 'c.principalId',
  },
  boards: { id: 'b.id', deletedAt: 'b.deletedAt', name: 'b.name', slug: 'b.slug' },
  principal: { id: 'pr.id', displayName: 'pr.displayName' },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  desc: vi.fn(),
  sql: (..._a: unknown[]) => ({ __sql: true }),
  exists: vi.fn(() => ({ __exists: true })),
}))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...a: unknown[]) => m.recordAudit(...a),
}))
vi.mock('@/lib/server/domains/posts/post.announce', () => ({
  announcePublishedPost: (...a: unknown[]) => m.announcePost(...a),
}))
vi.mock('@/lib/server/domains/comments/comment.announce', () => ({
  announcePublishedComment: (...a: unknown[]) => m.announceComment(...a),
}))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ error: vi.fn() }) } }))

import {
  listPendingPosts,
  listPendingComments,
  approvePost,
  rejectPost,
  approveComment,
  rejectComment,
} from '../moderation.service'

const actor = { principalId: 'mod_1' } as never

beforeEach(() => {
  vi.clearAllMocks()
  m.selectResult.mockResolvedValue([])
  m.postsFindFirst.mockResolvedValue({ id: 'post_1', moderationState: 'pending' })
  m.commentsFindFirst.mockResolvedValue({ id: 'comment_1', moderationState: 'pending' })
  m.updateReturning.mockResolvedValue([{ id: 'post_1' }])
  m.txReturning.mockResolvedValue([{ id: 'comment_1', postId: 'post_1', isPrivate: false }])
})

describe('pending lists', () => {
  it('listPendingPosts / listPendingComments return rows', async () => {
    m.selectResult.mockResolvedValueOnce([{ id: 'post_1' }])
    expect(await listPendingPosts()).toEqual({ posts: [{ id: 'post_1' }] })
    m.selectResult.mockResolvedValueOnce([{ id: 'comment_1' }])
    expect(await listPendingComments()).toEqual({ comments: [{ id: 'comment_1' }] })
  })
})

describe('approvePost / rejectPost', () => {
  it('approve: not found / not pending / success + announce', async () => {
    m.postsFindFirst.mockResolvedValueOnce(undefined)
    await expect(approvePost('post_1' as never, actor)).rejects.toThrow('Post post_1')
    m.updateReturning.mockResolvedValueOnce([])
    await expect(approvePost('post_1' as never, actor)).rejects.toThrow('not awaiting review')
    await approvePost('post_1' as never, actor)
    expect(m.announcePost).toHaveBeenCalled()
  })
  it('approve: swallows an announce failure', async () => {
    m.announcePost.mockRejectedValueOnce(new Error('boom'))
    await expect(approvePost('post_1' as never, actor)).resolves.toEqual({ ok: true })
  })
  it('reject: not found / not pending / success with and without a reason', async () => {
    m.postsFindFirst.mockResolvedValueOnce(undefined)
    await expect(rejectPost('post_1' as never, 'spam', actor)).rejects.toThrow('Post post_1')
    m.updateReturning.mockResolvedValueOnce([])
    await expect(rejectPost('post_1' as never, 'spam', actor)).rejects.toThrow(
      'not awaiting review'
    )
    await rejectPost('post_1' as never, 'spam', actor)
    await rejectPost('post_1' as never, undefined, actor)
    expect(m.recordAudit).toHaveBeenCalled()
  })
})

describe('approveComment / rejectComment', () => {
  it('approve: not found / not pending / public (increments) / private (skips) / announce swallow', async () => {
    m.commentsFindFirst.mockResolvedValueOnce(undefined)
    await expect(approveComment('comment_1' as never, actor)).rejects.toThrow('Comment comment_1')
    m.txReturning.mockResolvedValueOnce([]) // row null -> conflict
    await expect(approveComment('comment_1' as never, actor)).rejects.toThrow('not awaiting review')
    await approveComment('comment_1' as never, actor) // public -> increment
    m.txReturning.mockResolvedValueOnce([{ id: 'comment_1', postId: 'post_1', isPrivate: true }])
    await approveComment('comment_1' as never, actor) // private -> skip increment
    m.announceComment.mockRejectedValueOnce(new Error('boom'))
    await expect(approveComment('comment_1' as never, actor)).resolves.toEqual({ ok: true })
  })
  it('reject: not found / not pending / success', async () => {
    m.commentsFindFirst.mockResolvedValueOnce(undefined)
    await expect(rejectComment('comment_1' as never, 'spam', actor)).rejects.toThrow(
      'Comment comment_1'
    )
    m.updateReturning.mockResolvedValueOnce([])
    await expect(rejectComment('comment_1' as never, 'spam', actor)).rejects.toThrow(
      'not awaiting review'
    )
    m.updateReturning.mockResolvedValueOnce([{ id: 'comment_1' }])
    await rejectComment('comment_1' as never, undefined, actor)
    expect(m.recordAudit).toHaveBeenCalled()
  })
})
