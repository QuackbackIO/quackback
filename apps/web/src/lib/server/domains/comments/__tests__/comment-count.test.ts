/**
 * Tests for comment count maintenance in comment.service.ts
 *
 * Verifies that createComment, softDeleteComment, and deleteComment
 * correctly update the denormalized comment_count on the posts table
 * within atomic transactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PrincipalId, PostCommentId, SegmentId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

// --- Mock tracking ---

const setCalls: unknown[] = []
const deleteCalls: unknown[] = []
let transactionUsed = false

// State the soft-delete UPDATE / hard-delete DELETE returning row reflects. The
// decrement decision reads moderationState/isPrivate from the LOCKED returning
// row (race-correct vs a stale pre-transaction snapshot), so the held-comment
// tests set this to 'pending'. Default 'published' → the decrement runs.
const returnedComment: { moderationState: string; isPrivate: boolean; deletedAt: Date | null } = {
  moderationState: 'published',
  isPrivate: false,
  deletedAt: null,
}

// Chainable mock builder for Drizzle query builder
function createChainMock() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn().mockReturnValue(chain)
  chain.set = vi.fn((...args: unknown[]) => {
    setCalls.push(args)
    return chain
  })
  chain.where = vi.fn().mockReturnValue(chain)
  chain.returning = vi.fn(async () => [
    {
      id: 'comment_mock' as PostCommentId,
      postId: 'post_mock' as PostId,
      content: 'test',
      parentId: null,
      principalId: 'principal_mock' as PrincipalId,
      isTeamMember: false,
      isPrivate: returnedComment.isPrivate,
      moderationState: returnedComment.moderationState,
      createdAt: new Date(),
      deletedAt: returnedComment.deletedAt,
      statusChangeFromId: null,
      statusChangeToId: null,
    },
  ])
  // Support .catch() for fire-and-forget patterns (e.g. createActivity)
  chain.catch = vi.fn().mockReturnValue(Promise.resolve())
  return chain
}

function createTx() {
  return {
    insert: vi.fn(() => createChainMock()),
    update: vi.fn(() => createChainMock()),
    delete: vi.fn(() => {
      const chain = createChainMock()
      deleteCalls.push('delete')
      return chain
    }),
  }
}

// Mock @/lib/server/db
vi.mock('@/lib/server/db', async () => {
  const mockDb = {
    query: {
      postComments: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'comment_mock',
          postId: 'post_mock',
          content: 'test comment',
          parentId: null,
          principalId: 'principal_mock',
          isTeamMember: false,
          createdAt: new Date(),
          deletedAt: null,
          post: {
            id: 'post_mock',
            title: 'Test Post',
            boardId: 'board_mock',
            statusId: 'post_status_mock',
            pinnedCommentId: null,
            board: { id: 'board_mock', slug: 'test' },
          },
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      posts: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'post_mock',
          title: 'Test Post',
          boardId: 'board_mock',
          statusId: 'post_status_mock',
          isCommentsLocked: false,
          moderationState: 'published',
          principalId: null,
          board: {
            id: 'board_mock',
            slug: 'test',
            access: {
              view: 'anonymous',
              vote: 'anonymous',
              comment: 'anonymous',
              submit: 'anonymous',
              segments: { view: [], vote: [], comment: [], submit: [] },
              moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
            },
          },
        }),
      },
      boards: {
        findFirst: vi.fn().mockResolvedValue({ id: 'board_mock', slug: 'test' }),
      },
      postStatuses: {
        findFirst: vi.fn().mockResolvedValue({ id: 'post_status_mock', name: 'Open' }),
      },
    },
    insert: vi.fn(() => createChainMock()),
    update: vi.fn(() => createChainMock()),
    delete: vi.fn(() => createChainMock()),
    transaction: vi.fn(async (fn: (tx: ReturnType<typeof createTx>) => Promise<unknown>) => {
      transactionUsed = true
      const tx = createTx()
      const result = await fn(tx)
      // Capture set calls from tx.update().set()
      return result
    }),
  }

  // Import real sql for tagged template literals
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  return {
    db: mockDb,
    eq: vi.fn(),
    and: vi.fn(),
    asc: vi.fn(),
    isNull: vi.fn(),
    sql: realSql,
    postComments: { id: 'id', postId: 'postId', parentId: 'parentId' },
    postCommentReactions: {},
    postCommentEditHistory: {},
    posts: { id: 'id', commentCount: 'comment_count' },
    boards: { id: 'id' },
    postStatuses: { id: 'id' },
    postActivity: {},
  }
})

// Mock subscriptions
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: vi.fn(),
}))

// Mock event dispatch
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchCommentCreated: vi.fn(),
  dispatchCommentUpdated: vi.fn(),
  dispatchCommentDeleted: vi.fn(),
  dispatchPostStatusChanged: vi.fn(),
  buildEventActor: vi.fn(() => ({ type: 'user', id: 'mock' })),
}))

// Mock shared utils
vi.mock('@/lib/shared', () => ({
  buildCommentTree: vi.fn(() => []),
  aggregateReactions: vi.fn(() => []),
  toStatusChange: vi.fn(),
}))

// canCreateComment loads the workspace requireApproval default for
// resolving board-level `inherit`. None for these tests — explicit
// `'on'` overrides exercise the held-comment paths directly.
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn().mockResolvedValue({
    moderationDefault: { requireApproval: 'none' },
  }),
}))

const portalActor: Actor = {
  principalId: 'principal_mock' as unknown as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set<SegmentId>(),
}

const adminActor: Actor = {
  principalId: 'principal_mock' as unknown as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set<SegmentId>(),
}

describe('Comment count maintenance', () => {
  beforeEach(() => {
    setCalls.length = 0
    deleteCalls.length = 0
    transactionUsed = false
    returnedComment.moderationState = 'published'
    returnedComment.isPrivate = false
    returnedComment.deletedAt = null
    vi.clearAllMocks()
  })

  describe('createComment', () => {
    it('should use a transaction', async () => {
      const { createComment } = await import('../comment.service')

      await createComment(
        { postId: 'post_mock' as PostId, content: 'Hello' },
        {
          principalId: 'principal_mock' as PrincipalId,
          role: 'user',
        },
        portalActor
      )

      expect(transactionUsed).toBe(true)
    })

    it('should increment comment_count in the transaction', async () => {
      const { createComment } = await import('../comment.service')

      await createComment(
        { postId: 'post_mock' as PostId, content: 'Hello' },
        {
          principalId: 'principal_mock' as PrincipalId,
          role: 'user',
        },
        portalActor
      )

      // Verify that one of the set() calls includes commentCount
      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(true)
    })

    it('should increment comment_count with status change in the transaction', async () => {
      const { createComment } = await import('../comment.service')

      await createComment(
        { postId: 'post_mock' as PostId, content: 'Reviewing', statusId: 'post_status_mock' },
        {
          principalId: 'principal_mock' as PrincipalId,
          role: 'admin',
        },
        adminActor
      )

      expect(transactionUsed).toBe(true)

      // Verify set() was called with both statusId and commentCount
      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(true)
    })

    it('does NOT increment commentCount when holding a pending comment', async () => {
      // Switch the board fixture to moderation.comments='on' so a portal
      // commenter lands as moderationState='pending'. The insert path
      // must skip the commentCount bump — approveCommentFn re-increments
      // when the comment becomes publicly visible.
      const { db } = await import('@/lib/server/db')
      vi.mocked(db.query.posts.findFirst).mockResolvedValueOnce({
        id: 'post_mock',
        title: 'Test Post',
        boardId: 'board_mock',
        statusId: 'post_status_mock',
        isCommentsLocked: false,
        moderationState: 'published',
        principalId: null,
        board: {
          id: 'board_mock',
          slug: 'test',
          access: {
            view: 'anonymous',
            vote: 'anonymous',
            comment: 'anonymous',
            submit: 'anonymous',
            segments: { view: [], vote: [], comment: [], submit: [] },
            moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'on' },
          },
        },
      } as never)

      const { createComment } = await import('../comment.service')
      await createComment(
        { postId: 'post_mock' as PostId, content: 'Held' },
        {
          principalId: 'principal_mock' as PrincipalId,
          role: 'user',
        },
        portalActor,
        { skipDispatch: true }
      )

      // No set() call should have included commentCount — the only
      // post-side write a held comment performs is the (skipped) bump.
      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(false)
    })
  })

  describe('softDeleteComment', () => {
    it('should use a transaction', async () => {
      const { softDeleteComment } = await import('../comment.permissions')

      await softDeleteComment('comment_mock' as PostCommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      expect(transactionUsed).toBe(true)
    })

    it('should decrement comment_count in the transaction', async () => {
      const { softDeleteComment } = await import('../comment.permissions')

      await softDeleteComment('comment_mock' as PostCommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      // Verify set() was called with commentCount
      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(true)
    })

    it('does NOT decrement comment_count when deleting a held (pending) comment', async () => {
      // A held comment was never added to the public count on insert (the
      // pending path skips the bump). Deleting it before approval must NOT
      // decrement, or it underflows the count of already-published comments.
      // Two findFirst calls: canDeleteComment, then softDeleteComment itself.
      const { db } = await import('@/lib/server/db')
      const heldComment = {
        id: 'comment_mock',
        postId: 'post_mock',
        content: 'held comment',
        parentId: null,
        principalId: 'principal_mock',
        isTeamMember: false,
        isPrivate: false,
        moderationState: 'pending',
        createdAt: new Date(),
        deletedAt: null,
        post: {
          id: 'post_mock',
          title: 'Test Post',
          boardId: 'board_mock',
          statusId: 'post_status_mock',
          pinnedCommentId: null,
          board: { id: 'board_mock', slug: 'test' },
        },
      }
      vi.mocked(db.query.postComments.findFirst)
        .mockResolvedValueOnce(heldComment as never)
        .mockResolvedValueOnce(heldComment as never)
      // The decrement decision reads the LOCKED returning row, so the held
      // state must be reflected there (not just on the findFirst snapshot).
      returnedComment.moderationState = 'pending'

      const { softDeleteComment } = await import('../comment.permissions')
      setCalls.length = 0

      await softDeleteComment('comment_mock' as PostCommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(false)
    })
  })

  describe('deleteComment', () => {
    it('should use a transaction', async () => {
      const { deleteComment } = await import('../comment.service')

      await deleteComment('comment_mock' as PostCommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      expect(transactionUsed).toBe(true)
    })

    it('should decrement comment_count in the transaction', async () => {
      const { deleteComment } = await import('../comment.service')

      await deleteComment('comment_mock' as PostCommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(true)
    })

    it('should NOT decrement comment_count when hard-deleting a soft-deleted comment', async () => {
      const { db } = await import('@/lib/server/db')
      // Override mock to return a soft-deleted comment
      vi.mocked(db.query.postComments.findFirst).mockResolvedValueOnce({
        id: 'comment_mock',
        postId: 'post_mock',
        content: 'test comment',
        parentId: null,
        principalId: 'principal_mock',
        isTeamMember: false,
        createdAt: new Date(),
        deletedAt: new Date('2026-01-01'), // already soft-deleted
        post: {
          id: 'post_mock',
          title: 'Test Post',
          boardId: 'board_mock',
          statusId: 'post_status_mock',
          pinnedCommentId: null,
          board: { id: 'board_mock', slug: 'test' },
        },
      } as never)
      // The decrement decision reads the deleted (locked) returning row, which
      // for an already-soft-deleted comment carries its deletedAt timestamp.
      returnedComment.deletedAt = new Date('2026-01-01')

      const { deleteComment } = await import('../comment.service')
      setCalls.length = 0

      await deleteComment('comment_mock' as PostCommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      // Should NOT have any set() call with commentCount
      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(false)
    })

    it('should NOT decrement comment_count when deleting a held (pending) comment', async () => {
      // Same invariant as softDeleteComment: a pending comment was never
      // counted on insert, so the hard-delete path must not decrement either.
      const { db } = await import('@/lib/server/db')
      vi.mocked(db.query.postComments.findFirst).mockResolvedValueOnce({
        id: 'comment_mock',
        postId: 'post_mock',
        content: 'held comment',
        parentId: null,
        principalId: 'principal_mock',
        isTeamMember: false,
        isPrivate: false,
        moderationState: 'pending',
        createdAt: new Date(),
        deletedAt: null,
        post: {
          id: 'post_mock',
          title: 'Test Post',
          boardId: 'board_mock',
          statusId: 'post_status_mock',
          pinnedCommentId: null,
          board: { id: 'board_mock', slug: 'test' },
        },
      } as never)
      // The decrement decision reads the deleted (locked) returning row.
      returnedComment.moderationState = 'pending'

      const { deleteComment } = await import('../comment.service')
      setCalls.length = 0

      await deleteComment('comment_mock' as PostCommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(false)
    })
  })
})
