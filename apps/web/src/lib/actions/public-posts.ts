import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq } from '@/lib/db'
import {
  createPost,
  voteOnPost,
  userEditPost,
  softDeletePost,
  canEditPost,
  canDeletePost,
  listPublicPosts,
  getAllUserVotedPostIds,
  getPublicRoadmapPostsPaginated,
} from '@/lib/posts'
import { getPublicBoardById } from '@/lib/boards'
import { getDefaultStatus } from '@/lib/statuses'
import { getMemberByUser } from '@/lib/members'
import { listPublicRoadmaps } from '@/lib/roadmaps'
// Import getPublicRoadmapPosts directly from roadmaps to avoid naming conflict with posts module
import { getPublicRoadmapPosts } from '@/lib/roadmaps'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { hashIP } from '@/lib/utils/ip-hash'
import { buildPostCreatedEvent } from '@/lib/events'
import { getJobAdapter } from '@quackback/jobs'
import {
  postIdSchema,
  boardIdSchema,
  statusIdSchema,
  tagIdSchema,
  roadmapIdSchema,
  type PostId,
  type BoardId,
  type StatusId,
  type TagId,
  type MemberId,
  type RoadmapId,
  type UserId,
} from '@quackback/ids'
import { actionOk, actionErr, mapDomainError, type ActionResult } from './types'

// ============================================
// Schemas
// ============================================

const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.any()).optional(),
})

const listPublicPostsSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  statusIds: z.array(statusIdSchema).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(tagIdSchema).optional(),
  sort: z.enum(['top', 'new', 'trending']).optional().default('top'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

const getPostPermissionsSchema = z.object({
  postId: postIdSchema,
})

const userEditPostSchema = z.object({
  postId: postIdSchema,
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required').max(10000),
  contentJson: tiptapContentSchema.optional(),
})

const userDeletePostSchema = z.object({
  postId: postIdSchema,
})

const toggleVoteSchema = z.object({
  postId: postIdSchema,
  ipHash: z.string().optional(),
})

const createPublicPostSchema = z.object({
  boardId: boardIdSchema,
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000),
  contentJson: tiptapContentSchema.optional(),
})

const getPublicRoadmapPostsSchema = z.object({
  roadmapId: roadmapIdSchema,
  statusId: statusIdSchema.optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
})

const getRoadmapPostsByStatusSchema = z.object({
  statusId: statusIdSchema,
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(10),
})

// ============================================
// Type Exports
// ============================================

export type ListPublicPostsInput = z.infer<typeof listPublicPostsSchema>
export type GetPostPermissionsInput = z.infer<typeof getPostPermissionsSchema>
export type UserEditPostInput = z.infer<typeof userEditPostSchema>
export type UserDeletePostInput = z.infer<typeof userDeletePostSchema>
export type ToggleVoteInput = z.infer<typeof toggleVoteSchema>
export type CreatePublicPostInput = z.infer<typeof createPublicPostSchema>
export type GetPublicRoadmapPostsInput = z.infer<typeof getPublicRoadmapPostsSchema>
export type GetRoadmapPostsByStatusInput = z.infer<typeof getRoadmapPostsByStatusSchema>

// ============================================
// Helper Functions
// ============================================

/**
 * Get member record for a user
 */
async function getMemberRecord(userId: UserId) {
  return db.query.member.findFirst({
    where: eq(member.userId, userId),
  })
}

// ============================================
// Actions
// ============================================

/**
 * List public posts with filtering (no auth required).
 */
export const listPublicPostsAction = createServerFn({ method: 'POST' })
  .inputValidator(listPublicPostsSchema)
  .handler(async ({ data: input }) => {
    try {
      const result = await listPublicPosts({
        boardSlug: input.boardSlug,
        search: input.search,
        statusIds: input.statusIds as StatusId[] | undefined,
        statusSlugs: input.statusSlugs,
        tagIds: input.tagIds as TagId[] | undefined,
        sort: input.sort,
        page: input.page,
        limit: input.limit,
      })

      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }

      return actionOk(result.value)
    } catch (error) {
      console.error('Error listing public posts:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * Get edit/delete permissions for a post (optional auth).
 */
export const getPostPermissionsAction = createServerFn({ method: 'POST' })
  .inputValidator(getPostPermissionsSchema)
  .handler(
    async ({
      data,
    }): Promise<
      ActionResult<{
        canEdit: boolean
        canDelete: boolean
        editReason?: string
        deleteReason?: string
      }>
    > => {
      try {
        const postId = data.postId as PostId

        // Check session (optional)
        const session = await getSession()
        if (!session?.user) {
          return actionOk({ canEdit: false, canDelete: false })
        }

        // Get member record
        const memberRecord = await getMemberRecord(session.user.id as UserId)
        if (!memberRecord) {
          return actionOk({ canEdit: false, canDelete: false })
        }

        // Build actor info for permission checks
        const actor = {
          memberId: memberRecord.id as MemberId,
          role: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
        }

        // Check permissions
        const [editResult, deleteResult] = await Promise.all([
          canEditPost(postId, actor),
          canDeletePost(postId, actor),
        ])

        return actionOk({
          canEdit: editResult.success ? editResult.value.allowed : false,
          canDelete: deleteResult.success ? deleteResult.value.allowed : false,
          editReason: editResult.success ? editResult.value.reason : undefined,
          deleteReason: deleteResult.success ? deleteResult.value.reason : undefined,
        })
      } catch (error) {
        console.error('Error getting post permissions:', error)
        return actionErr({
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          status: 500,
        })
      }
    }
  )

/**
 * User edits their own post.
 */
export const userEditPostAction = createServerFn({ method: 'POST' })
  .inputValidator(userEditPostSchema)
  .handler(async ({ data }) => {
    try {
      const { postId: postIdRaw, title, content, contentJson } = data
      const postId = postIdRaw as PostId

      // Require auth
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please sign in to edit.',
          status: 401,
        })
      }

      // Get member record
      const memberRecord = await getMemberRecord(session.user.id as UserId)
      if (!memberRecord) {
        return actionErr({
          code: 'FORBIDDEN',
          message: 'You must be a member to edit posts.',
          status: 403,
        })
      }

      // Build actor info for permission check
      const actor = {
        memberId: memberRecord.id as MemberId,
        role: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
      }

      const result = await userEditPost(postId, { title, content, contentJson }, actor)
      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }

      return actionOk(result.value)
    } catch (error) {
      console.error('Error editing post:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * User soft-deletes their own post.
 */
export const userDeletePostAction = createServerFn({ method: 'POST' })
  .inputValidator(userDeletePostSchema)
  .handler(async ({ data }): Promise<ActionResult<{ success: boolean }>> => {
    try {
      const postId = data.postId as PostId

      // Require auth
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please sign in to delete.',
          status: 401,
        })
      }

      // Get member record
      const memberRecord = await getMemberRecord(session.user.id as UserId)
      if (!memberRecord) {
        return actionErr({
          code: 'FORBIDDEN',
          message: 'You must be a member to delete posts.',
          status: 403,
        })
      }

      // Build actor info for permission check
      const actor = {
        memberId: memberRecord.id as MemberId,
        role: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
      }

      const result = await softDeletePost(postId, actor)
      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }

      return actionOk({ success: true })
    } catch (error) {
      console.error('Error deleting post:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * Toggle vote on a post.
 */
export const toggleVoteAction = createServerFn({ method: 'POST' })
  .inputValidator(toggleVoteSchema)
  .handler(async ({ data }): Promise<ActionResult<{ voted: boolean; voteCount: number }>> => {
    try {
      const postId = data.postId as PostId
      const clientIpHash = data.ipHash

      // Require auth
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please sign in to vote.',
          status: 401,
        })
      }

      // Get member record
      const memberRecord = await getMemberRecord(session.user.id as UserId)
      if (!memberRecord) {
        return actionErr({
          code: 'FORBIDDEN',
          message: 'You must be a member to vote.',
          status: 403,
        })
      }

      const memberId = memberRecord.id as MemberId
      const userIdentifier = getMemberIdentifier(memberId)

      // Generate IP hash if not provided (for privacy-preserving storage)
      const ipHash =
        clientIpHash || hashIP('unknown', process.env.BETTER_AUTH_SECRET || 'default-salt')

      const result = await voteOnPost(postId, userIdentifier, {
        memberId,
        ipHash,
      })

      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }

      return actionOk(result.value)
    } catch (error) {
      console.error('Error toggling vote:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * Create a post on a public board.
 */
export const createPublicPostAction = createServerFn({ method: 'POST' })
  .inputValidator(createPublicPostSchema)
  .handler(async ({ data }) => {
    try {
      const { boardId: boardIdRaw, title, content, contentJson } = data
      const boardId = boardIdRaw as BoardId

      // Get board and verify it exists and is public
      const boardResult = await getPublicBoardById(boardId)
      if (!boardResult.success || !boardResult.value.isPublic) {
        return actionErr({ code: 'NOT_FOUND', message: 'Board not found', status: 404 })
      }
      const board = boardResult.value

      // Require auth
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please sign in to submit feedback.',
          status: 401,
        })
      }

      // Get member record
      const memberResult = await getMemberByUser(session.user.id as UserId)
      if (!memberResult.success || !memberResult.value) {
        return actionErr({
          code: 'FORBIDDEN',
          message: 'You must be a member to submit feedback.',
          status: 403,
        })
      }
      const memberRecord = memberResult.value

      // Build author info
      const author = {
        memberId: memberRecord.id as MemberId,
        name: session.user.name || session.user.email,
        email: session.user.email,
      }

      // Get default status
      const defaultStatusResult = await getDefaultStatus()
      if (!defaultStatusResult.success) {
        return actionErr({
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve default status',
          status: 500,
        })
      }
      const defaultStatus = defaultStatusResult.value

      // Create the post
      const createResult = await createPost(
        {
          boardId,
          title,
          content,
          contentJson,
          statusId: defaultStatus?.id,
        },
        author
      )

      if (!createResult.success) {
        return actionErr(mapDomainError(createResult.error))
      }

      const post = createResult.value

      // Get settings for organization info
      const { getSettings } = await import('@/lib/workspace')
      const settings = await getSettings()
      if (!settings) {
        return actionErr({
          code: 'INTERNAL_ERROR',
          message: 'Organization settings not found',
          status: 500,
        })
      }

      // Trigger EventWorkflow for integrations and notifications
      const eventData = buildPostCreatedEvent(
        { type: 'user', userId: session.user.id as UserId, email: session.user.email },
        {
          id: post.id,
          title: post.title,
          content: post.content,
          boardId: post.boardId,
          boardSlug: board.slug,
          authorEmail: session.user.email,
          voteCount: post.voteCount,
        }
      )

      const jobAdapter = getJobAdapter()
      await jobAdapter.addEventJob(eventData)

      return actionOk({
        id: post.id,
        title: post.title,
        content: post.content,
        statusId: post.statusId,
        voteCount: post.voteCount,
        createdAt: post.createdAt,
        board: {
          id: board.id,
          name: board.name,
          slug: board.slug,
        },
      })
    } catch (error) {
      console.error('Error creating public post:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * Get all post IDs the user has voted on (optional auth).
 */
export const getVotedPostsAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionResult<{ votedPostIds: string[] }>> => {
    try {
      // Optional auth - return empty if not authenticated
      const session = await getSession()
      if (!session?.user) {
        return actionOk({ votedPostIds: [] })
      }

      // Get member record
      const memberRecord = await getMemberRecord(session.user.id as UserId)
      if (!memberRecord) {
        return actionOk({ votedPostIds: [] })
      }

      const userIdentifier = getMemberIdentifier(memberRecord.id)
      const result = await getAllUserVotedPostIds(userIdentifier)

      if (!result.success) {
        return actionOk({ votedPostIds: [] })
      }

      return actionOk({ votedPostIds: Array.from(result.value) })
    } catch (error) {
      console.error('Error fetching voted posts:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  }
)

/**
 * List public roadmaps for a workspace (no auth required).
 */
export const listPublicRoadmapsAction = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const result = await listPublicRoadmaps()
    if (!result.success) {
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: result.error.message,
        status: 500,
      })
    }

    return actionOk(result.value)
  } catch (error) {
    console.error('Error fetching public roadmaps:', error)
    return actionErr({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      status: 500,
    })
  }
})

/**
 * Get posts for a public roadmap (no auth required).
 */
export const getPublicRoadmapPostsAction = createServerFn({ method: 'POST' })
  .inputValidator(getPublicRoadmapPostsSchema)
  .handler(async ({ data }) => {
    try {
      const { roadmapId, statusId, limit, offset } = data

      const result = await getPublicRoadmapPosts(roadmapId as RoadmapId, {
        statusId: statusId as StatusId | undefined,
        limit,
        offset,
      })

      if (!result.success) {
        const status = result.error.code === 'ROADMAP_NOT_FOUND' ? 404 : 500
        return actionErr({
          code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
          message: result.error.message,
          status,
        })
      }

      return actionOk(result.value)
    } catch (error) {
      console.error('Error fetching public roadmap posts:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * Get paginated posts for roadmap view filtered by status (legacy).
 */
export const getRoadmapPostsByStatusAction = createServerFn({ method: 'POST' })
  .inputValidator(getRoadmapPostsByStatusSchema)
  .handler(async ({ data }) => {
    try {
      const { statusId, page, limit } = data

      const result = await getPublicRoadmapPostsPaginated({
        statusId: statusId as StatusId,
        page,
        limit,
      })

      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }

      return actionOk(result.value)
    } catch (error) {
      console.error('Error fetching roadmap posts by status:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })
