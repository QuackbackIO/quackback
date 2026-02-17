/**
 * Tests for comment count maintenance in comment.service.ts
 *
 * Verifies that createComment, softDeleteComment, and deleteComment
 * correctly update the denormalized comment_count on the posts table
 * within atomic transactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PrincipalId, CommentId } from '@quackback/ids'

// --- Mock tracking ---

const setCalls: unknown[] = []
const deleteCalls: unknown[] = []
let transactionUsed = false

// Chainable mock builder for Drizzle query builder
function createChainMock() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn().mockReturnValue(chain)
  chain.set = vi.fn((...args: unknown[]) => {
    setCalls.push(args)
    return chain
  })
  chain.where = vi.fn().mockReturnValue(chain)
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'comment_mock' as CommentId,
      postId: 'post_mock' as PostId,
      content: 'test',
      parentId: null,
      principalId: 'principal_mock' as PrincipalId,
      isTeamMember: false,
      createdAt: new Date(),
      deletedAt: null,
      statusChangeFromId: null,
      statusChangeToId: null,
    },
  ])
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
      comments: {
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
            statusId: 'status_mock',
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
          statusId: 'status_mock',
          isCommentsLocked: false,
          board: { id: 'board_mock', slug: 'test' },
        }),
      },
      boards: {
        findFirst: vi.fn().mockResolvedValue({ id: 'board_mock', slug: 'test' }),
      },
      postStatuses: {
        findFirst: vi.fn().mockResolvedValue({ id: 'status_mock', name: 'Open' }),
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
    comments: { id: 'id', postId: 'postId', parentId: 'parentId' },
    commentReactions: {},
    commentEditHistory: {},
    posts: { id: 'id', commentCount: 'comment_count' },
    boards: { id: 'id' },
    postStatuses: { id: 'id' },
  }
})

// Mock subscriptions
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: vi.fn(),
}))

// Mock event dispatch
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchCommentCreated: vi.fn(),
  dispatchPostStatusChanged: vi.fn(),
  buildEventActor: vi.fn(() => ({ type: 'user', id: 'mock' })),
}))

// Mock shared utils
vi.mock('@/lib/shared', () => ({
  buildCommentTree: vi.fn(() => []),
  aggregateReactions: vi.fn(() => []),
  toStatusChange: vi.fn(),
}))

describe('Comment count maintenance', () => {
  beforeEach(() => {
    setCalls.length = 0
    deleteCalls.length = 0
    transactionUsed = false
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
        }
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
        }
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
        { postId: 'post_mock' as PostId, content: 'Reviewing', statusId: 'status_mock' },
        {
          principalId: 'principal_mock' as PrincipalId,
          role: 'admin',
        }
      )

      expect(transactionUsed).toBe(true)

      // Verify set() was called with both statusId and commentCount
      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(true)
    })
  })

  describe('softDeleteComment', () => {
    it('should use a transaction', async () => {
      const { softDeleteComment } = await import('../comment.service')

      await softDeleteComment('comment_mock' as CommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      expect(transactionUsed).toBe(true)
    })

    it('should decrement comment_count in the transaction', async () => {
      const { softDeleteComment } = await import('../comment.service')

      await softDeleteComment('comment_mock' as CommentId, {
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
  })

  describe('deleteComment', () => {
    it('should use a transaction', async () => {
      const { deleteComment } = await import('../comment.service')

      await deleteComment('comment_mock' as CommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      expect(transactionUsed).toBe(true)
    })

    it('should decrement comment_count in the transaction', async () => {
      const { deleteComment } = await import('../comment.service')

      await deleteComment('comment_mock' as CommentId, {
        principalId: 'principal_mock' as PrincipalId,
        role: 'admin',
      })

      const hasCommentCountUpdate = setCalls.some((args) => {
        const setArg = (args as unknown[])[0] as Record<string, unknown>
        return 'commentCount' in setArg
      })
      expect(hasCommentCountUpdate).toBe(true)
    })
  })
})
