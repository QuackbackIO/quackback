/**
 * Tests for post permission checks in post.permissions.ts
 *
 * Focuses on:
 * - softDeletePost: permission enforcement and soft-delete behavior
 * - restorePost: 30-day restore window, validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PrincipalId } from '@quackback/ids'

// --- Mock tracking ---

const updateSetCalls: unknown[] = []

function createChainMock() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn().mockReturnValue(chain)
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.where = vi.fn().mockReturnValue(chain)
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'post_mock' as PostId,
      title: 'Test Post',
      deletedAt: null,
      deletedByPrincipalId: null,
    },
  ])
  return chain
}

// Track what findFirst returns per call
const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  return {
    db: {
      query: {
        posts: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
        postStatuses: {
          findFirst: vi.fn().mockResolvedValue({ id: 'status_mock', isDefault: true }),
        },
        comments: { findFirst: vi.fn().mockResolvedValue(null) },
        settings: { findFirst: vi.fn().mockResolvedValue(null) },
      },
      update: vi.fn(() => createChainMock()),
      select: vi.fn(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      })),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    sql: realSql,
    posts: {
      id: 'id',
      deletedAt: 'deleted_at',
      deletedByPrincipalId: 'deleted_by_principal_id',
      principalId: 'principal_id',
      boardId: 'board_id',
      statusId: 'status_id',
    },
    comments: { postId: 'post_id', principalId: 'principal_id', deletedAt: 'deleted_at' },
    postEditHistory: {},
    postStatuses: { id: 'id', isDefault: 'is_default' },
  }
})

// Constants
const TEAM_ACTOR = {
  principalId: 'principal_admin' as PrincipalId,
  role: 'admin' as const,
}

const USER_ACTOR = {
  principalId: 'principal_user' as PrincipalId,
  role: 'user' as const,
}

const POST_ID = 'post_mock' as PostId

describe('post.permissions', () => {
  beforeEach(() => {
    updateSetCalls.length = 0
    vi.clearAllMocks()
  })

  // ===========================================================================
  // restorePost
  // ===========================================================================

  describe('restorePost', () => {
    it('should throw NotFoundError when post does not exist', async () => {
      mockFindFirst.mockResolvedValueOnce(null)
      const { restorePost } = await import('../post.permissions')

      await expect(restorePost(POST_ID)).rejects.toThrow('not found')
    })

    it('should throw ValidationError when post is not deleted', async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: POST_ID,
        title: 'Test Post',
        deletedAt: null,
      })
      const { restorePost } = await import('../post.permissions')

      await expect(restorePost(POST_ID)).rejects.toThrow('not deleted')
    })

    it('should throw ValidationError when post was deleted more than 30 days ago', async () => {
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
      mockFindFirst.mockResolvedValueOnce({
        id: POST_ID,
        title: 'Test Post',
        deletedAt: thirtyOneDaysAgo,
      })
      const { restorePost } = await import('../post.permissions')

      await expect(restorePost(POST_ID)).rejects.toThrow('30 days')
    })

    it('should succeed when post was deleted within 30 days', async () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      mockFindFirst.mockResolvedValueOnce({
        id: POST_ID,
        title: 'Test Post',
        deletedAt: fiveDaysAgo,
      })
      const { restorePost } = await import('../post.permissions')

      const result = await restorePost(POST_ID)
      expect(result).toBeDefined()
      expect(result.id).toBe(POST_ID)
    })

    it('should succeed at exactly the 30-day boundary', async () => {
      // Just under 30 days ago (29 days, 23 hours)
      const justUnder30Days = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000))
      mockFindFirst.mockResolvedValueOnce({
        id: POST_ID,
        title: 'Test Post',
        deletedAt: justUnder30Days,
      })
      const { restorePost } = await import('../post.permissions')

      const result = await restorePost(POST_ID)
      expect(result).toBeDefined()
    })

    it('should clear deletedAt and deletedByPrincipalId', async () => {
      const recentlyDeleted = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
      mockFindFirst.mockResolvedValueOnce({
        id: POST_ID,
        title: 'Test Post',
        deletedAt: recentlyDeleted,
        deletedByPrincipalId: 'principal_admin',
      })
      const { restorePost } = await import('../post.permissions')

      await restorePost(POST_ID)

      // Verify the update set null for both fields
      expect(updateSetCalls.length).toBeGreaterThanOrEqual(1)
      const setArg = (updateSetCalls[0] as unknown[])[0] as Record<string, unknown>
      expect(setArg.deletedAt).toBeNull()
      expect(setArg.deletedByPrincipalId).toBeNull()
    })
  })

  // ===========================================================================
  // softDeletePost
  // ===========================================================================

  describe('softDeletePost', () => {
    it('should throw NotFoundError when post does not exist', async () => {
      mockFindFirst.mockResolvedValueOnce(null)
      const { softDeletePost } = await import('../post.permissions')

      await expect(softDeletePost(POST_ID, TEAM_ACTOR)).rejects.toThrow('not found')
    })

    it('should throw ForbiddenError when post is already deleted', async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: POST_ID,
        title: 'Test Post',
        deletedAt: new Date(),
        postStatus: { isDefault: true },
      })
      const { softDeletePost } = await import('../post.permissions')

      await expect(softDeletePost(POST_ID, TEAM_ACTOR)).rejects.toThrow('already been deleted')
    })

    it('should succeed for team member (admin)', async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: POST_ID,
        title: 'Test Post',
        deletedAt: null,
        postStatus: { isDefault: true },
      })
      const { softDeletePost } = await import('../post.permissions')

      await expect(softDeletePost(POST_ID, TEAM_ACTOR)).resolves.not.toThrow()
    })

    it('should set deletedAt and deletedByPrincipalId', async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: POST_ID,
        title: 'Test Post',
        deletedAt: null,
        postStatus: { isDefault: true },
      })
      const { softDeletePost } = await import('../post.permissions')

      await softDeletePost(POST_ID, TEAM_ACTOR)

      expect(updateSetCalls.length).toBeGreaterThanOrEqual(1)
      const setArg = (updateSetCalls[0] as unknown[])[0] as Record<string, unknown>
      expect(setArg.deletedAt).toBeInstanceOf(Date)
      expect(setArg.deletedByPrincipalId).toBe(TEAM_ACTOR.principalId)
    })

    it('should throw ForbiddenError when portal user tries to delete another user post', async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: POST_ID,
        title: 'Test Post',
        deletedAt: null,
        principalId: 'principal_other' as PrincipalId,
        postStatus: { isDefault: true },
      })
      const { softDeletePost } = await import('../post.permissions')

      await expect(softDeletePost(POST_ID, USER_ACTOR)).rejects.toThrow('only delete your own')
    })
  })
})
