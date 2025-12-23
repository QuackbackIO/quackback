'use server'

import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq } from '@/lib/db'
import {
  getPostService,
  getPublicPostService,
  getPublicBoardService,
  getStatusService,
  getMemberService,
  getRoadmapService,
} from '@/lib/services'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { hashIP } from '@/lib/utils/ip-hash'
import { buildServiceContext, buildPostCreatedEvent, type ServiceContext } from '@quackback/domain'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getJobAdapter, isCloudflareWorker } from '@quackback/jobs'
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
import { actionOk, actionErr, type ActionResult } from './types'
import { mapDomainError } from './with-action'

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

const getVotedPostsSchema = z.object({})

const listPublicRoadmapsSchema = z.object({})

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
export type GetVotedPostsInput = z.infer<typeof getVotedPostsSchema>
export type ListPublicRoadmapsInput = z.infer<typeof listPublicRoadmapsSchema>
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

/**
 * Build service context from session and member
 */
function buildCtx(
  session: { user: { id: string; email: string; name: string | null } },
  memberRecord: { id: string; role: string }
): ServiceContext {
  return buildServiceContext({
    user: {
      id: session.user.id as UserId,
      name: session.user.name,
      email: session.user.email,
    },
    member: {
      id: memberRecord.id as MemberId,
      role: memberRecord.role,
    },
  })
}

// ============================================
// Actions
// ============================================

/**
 * List public posts with filtering (no auth required).
 */
export async function listPublicPostsAction(
  rawInput: ListPublicPostsInput
): Promise<ActionResult<unknown>> {
  try {
    const parseResult = listPublicPostsSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const input = parseResult.data

    // Get organizationId from settings
    const { getSettings } = await import('@/lib/tenant')
    const settings = await getSettings()
    if (!settings) {
      return actionErr({
        code: 'NOT_FOUND',
        message: 'Organization not found',
        status: 404,
      })
    }

    const result = await getPublicPostService().listPosts({
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
}

/**
 * Get edit/delete permissions for a post (optional auth).
 */
export async function getPostPermissionsAction(rawInput: GetPostPermissionsInput): Promise<
  ActionResult<{
    canEdit: boolean
    canDelete: boolean
    editReason?: string
    deleteReason?: string
  }>
> {
  try {
    const parseResult = getPostPermissionsSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const postId = parseResult.data.postId as PostId

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

    const ctx = buildCtx(session, memberRecord)
    const postService = getPostService()

    // Check permissions
    const [editResult, deleteResult] = await Promise.all([
      postService.canEditPost(postId, ctx),
      postService.canDeletePost(postId, ctx),
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

/**
 * User edits their own post.
 */
export async function userEditPostAction(
  rawInput: UserEditPostInput
): Promise<ActionResult<unknown>> {
  try {
    const parseResult = userEditPostSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const { postId: postIdRaw, title, content, contentJson } = parseResult.data
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

    const ctx = buildCtx(session, memberRecord)

    const result = await getPostService().userEditPost(postId, { title, content, contentJson }, ctx)
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
}

/**
 * User soft-deletes their own post.
 */
export async function userDeletePostAction(
  rawInput: UserDeletePostInput
): Promise<ActionResult<{ success: boolean }>> {
  try {
    const parseResult = userDeletePostSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const postId = parseResult.data.postId as PostId

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

    const ctx = buildCtx(session, memberRecord)

    const result = await getPostService().softDeletePost(postId, ctx)
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
}

/**
 * Toggle vote on a post.
 */
export async function toggleVoteAction(
  rawInput: ToggleVoteInput
): Promise<ActionResult<{ voted: boolean; voteCount: number }>> {
  try {
    const parseResult = toggleVoteSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const postId = parseResult.data.postId as PostId
    const clientIpHash = parseResult.data.ipHash

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
    const ctx = buildCtx(session, memberRecord)

    // Generate IP hash if not provided (for privacy-preserving storage)
    const ipHash =
      clientIpHash || hashIP('unknown', process.env.BETTER_AUTH_SECRET || 'default-salt')

    const result = await getPostService().voteOnPost(postId, userIdentifier, ctx, {
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
}

/**
 * Create a post on a public board.
 */
export async function createPublicPostAction(
  rawInput: CreatePublicPostInput
): Promise<ActionResult<unknown>> {
  try {
    const parseResult = createPublicPostSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const { boardId: boardIdRaw, title, content, contentJson } = parseResult.data
    const boardId = boardIdRaw as BoardId

    // Get board and verify it exists and is public
    const boardResult = await getPublicBoardService().getBoardById(boardId)
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
    const memberResult = await getMemberService().getMemberByUser(session.user.id as UserId)
    if (!memberResult.success || !memberResult.value) {
      return actionErr({
        code: 'FORBIDDEN',
        message: 'You must be a member to submit feedback.',
        status: 403,
      })
    }
    const memberRecord = memberResult.value

    const ctx = buildCtx(session, memberRecord)

    // Get default status
    const defaultStatusResult = await getStatusService().getDefaultStatus(ctx)
    if (!defaultStatusResult.success) {
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve default status',
        status: 500,
      })
    }
    const defaultStatus = defaultStatusResult.value

    // Create the post
    const createResult = await getPostService().createPost(
      {
        boardId,
        title,
        content,
        contentJson,
        statusId: defaultStatus?.id,
      },
      ctx
    )

    if (!createResult.success) {
      return actionErr(mapDomainError(createResult.error))
    }

    const post = createResult.value

    // Get organizationId from settings for event
    const { getSettings } = await import('@/lib/tenant')
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
      settings.id,
      { type: 'user', userId: ctx.userId, email: ctx.userEmail },
      {
        id: post.id,
        title: post.title,
        content: post.content,
        boardId: post.boardId,
        boardSlug: board.slug,
        authorEmail: ctx.userEmail,
        voteCount: post.voteCount,
      }
    )
    const env = isCloudflareWorker() ? getCloudflareContext().env : undefined
    const jobAdapter = getJobAdapter(env)
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
}

/**
 * Get all post IDs the user has voted on (optional auth).
 */
export async function getVotedPostsAction(
  rawInput: GetVotedPostsInput
): Promise<ActionResult<{ votedPostIds: string[] }>> {
  try {
    const parseResult = getVotedPostsSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

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
    const result = await getPublicPostService().getAllUserVotedPostIds(userIdentifier)

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

/**
 * List public roadmaps for a workspace (no auth required).
 */
export async function listPublicRoadmapsAction(
  rawInput: ListPublicRoadmapsInput
): Promise<ActionResult<unknown[]>> {
  try {
    const parseResult = listPublicRoadmapsSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    // Get organizationId from settings
    const { getSettings } = await import('@/lib/tenant')
    const settings = await getSettings()
    if (!settings) {
      return actionErr({
        code: 'NOT_FOUND',
        message: 'Organization not found',
        status: 404,
      })
    }

    const result = await getRoadmapService().listPublicRoadmaps()
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
}

/**
 * Get posts for a public roadmap (no auth required).
 */
export async function getPublicRoadmapPostsAction(
  rawInput: GetPublicRoadmapPostsInput
): Promise<ActionResult<unknown>> {
  try {
    const parseResult = getPublicRoadmapPostsSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const { roadmapId, statusId, limit, offset } = parseResult.data

    // Get organizationId from settings
    const { getSettings } = await import('@/lib/tenant')
    const settings = await getSettings()
    if (!settings) {
      return actionErr({
        code: 'NOT_FOUND',
        message: 'Organization not found',
        status: 404,
      })
    }

    const result = await getRoadmapService().getPublicRoadmapPosts(roadmapId as RoadmapId, {
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
}

/**
 * Get paginated posts for roadmap view filtered by status (legacy).
 */
export async function getRoadmapPostsByStatusAction(
  rawInput: GetRoadmapPostsByStatusInput
): Promise<ActionResult<unknown>> {
  try {
    const parseResult = getRoadmapPostsByStatusSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const { statusId, page, limit } = parseResult.data

    // Get organizationId from settings
    const { getSettings } = await import('@/lib/tenant')
    const settings = await getSettings()
    if (!settings) {
      return actionErr({
        code: 'NOT_FOUND',
        message: 'Organization not found',
        status: 404,
      })
    }

    const result = await getPublicPostService().getRoadmapPostsPaginated({
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
}

/**
 * Get the current organization ID from settings (no auth required).
 * In single-tenant mode, this returns the singleton organization ID.
 */
export async function getOrganizationIdAction(
  _rawInput?: GetOrganizationIdInput
): Promise<ActionResult<{ organizationId: string }>> {
  try {
    const { getSettings } = await import('@/lib/tenant')
    const settings = await getSettings()

    if (!settings) {
      return actionErr({
        code: 'NOT_FOUND',
        message: 'Organization settings not found',
        status: 404,
      })
    }

    return actionOk({ organizationId: settings.id })
  } catch (error) {
    console.error('Error fetching organization ID:', error)
    return actionErr({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      status: 500,
    })
  }
}
