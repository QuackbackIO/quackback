'use server'

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth, getOptionalAuth } from './auth-helpers'
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
  hasUserVoted,
} from '@/lib/posts'
import { getPublicBoardById } from '@/lib/boards'
import { getDefaultStatus } from '@/lib/statuses'
import { getMemberByUser } from '@/lib/members'
import { listPublicRoadmaps } from '@/lib/roadmaps'
import { getPublicRoadmapPosts } from '@/lib/roadmaps'
import { getSubscriptionStatus, type SubscriptionReason } from '@/lib/subscriptions'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { hashIP } from '@/lib/utils/ip-hash'
import { dispatchPostCreated } from '@/lib/events/dispatch'
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
import { getSettings } from './workspace'

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

const getVoteSidebarDataSchema = z.object({
  postId: postIdSchema,
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
export type GetVoteSidebarDataInput = z.infer<typeof getVoteSidebarDataSchema>

// ============================================
// Server Functions
// ============================================

/**
 * List public posts with filtering (no auth required).
 */
export const listPublicPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(listPublicPostsSchema)
  .handler(async ({ data }: { data: ListPublicPostsInput }) => {
    await getOptionalAuth()

    const result = await listPublicPosts({
      boardSlug: data.boardSlug,
      search: data.search,
      statusIds: data.statusIds as StatusId[] | undefined,
      statusSlugs: data.statusSlugs,
      tagIds: data.tagIds as TagId[] | undefined,
      sort: data.sort,
      page: data.page,
      limit: data.limit,
    })

    if (!result.success) {
      throw new Error(result.error.message)
    }

    // Serialize Date fields
    return {
      ...result.value,
      items: result.value.items.map((post) => ({
        ...post,
        createdAt: post.createdAt.toISOString(),
      })),
    }
  })

/**
 * Get edit/delete permissions for a post (optional auth).
 */
export const getPostPermissionsFn = createServerFn({ method: 'GET' })
  .inputValidator(getPostPermissionsSchema)
  .handler(
    async ({
      data,
    }: {
      data: GetPostPermissionsInput
    }): Promise<{
      canEdit: boolean
      canDelete: boolean
      editReason?: string
      deleteReason?: string
    }> => {
      const ctx = await getOptionalAuth()
      const postId = data.postId as PostId

      // If no user/member, return no permissions
      if (!ctx.user || !ctx.member) {
        return { canEdit: false, canDelete: false }
      }

      // Build actor info for permission checks
      const actor = {
        memberId: ctx.member.id,
        role: ctx.member.role,
      }

      // Check permissions
      const [editResult, deleteResult] = await Promise.all([
        canEditPost(postId, actor),
        canDeletePost(postId, actor),
      ])

      return {
        canEdit: editResult.success ? editResult.value.allowed : false,
        canDelete: deleteResult.success ? deleteResult.value.allowed : false,
        editReason: editResult.success ? editResult.value.reason : undefined,
        deleteReason: deleteResult.success ? deleteResult.value.reason : undefined,
      }
    }
  )

/**
 * User edits their own post.
 */
export const userEditPostFn = createServerFn({ method: 'POST' })
  .inputValidator(userEditPostSchema)
  .handler(async ({ data }: { data: UserEditPostInput }) => {
    const ctx = await requireAuth()
    const { postId: postIdRaw, title, content, contentJson } = data
    const postId = postIdRaw as PostId

    // Build actor info for permission check
    const actor = {
      memberId: ctx.member.id,
      role: ctx.member.role,
    }

    const result = await userEditPost(postId, { title, content, contentJson }, actor)
    if (!result.success) {
      throw new Error(result.error.message)
    }

    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
      deletedAt: result.value.deletedAt?.toISOString() || null,
      officialResponseAt: result.value.officialResponseAt?.toISOString() || null,
    }
  })

/**
 * User soft-deletes their own post.
 */
export const userDeletePostFn = createServerFn({ method: 'POST' })
  .inputValidator(userDeletePostSchema)
  .handler(async ({ data }: { data: UserDeletePostInput }) => {
    const ctx = await requireAuth()
    const postId = data.postId as PostId

    // Build actor info for permission check
    const actor = {
      memberId: ctx.member.id,
      role: ctx.member.role,
    }

    const result = await softDeletePost(postId, actor)
    if (!result.success) {
      throw new Error(result.error.message)
    }

    return { id: postId }
  })

/**
 * Toggle vote on a post.
 */
export const toggleVoteFn = createServerFn({ method: 'POST' })
  .inputValidator(toggleVoteSchema)
  .handler(
    async ({ data }: { data: ToggleVoteInput }): Promise<{ voted: boolean; voteCount: number }> => {
      const ctx = await requireAuth()
      const postId = data.postId as PostId
      const clientIpHash = data.ipHash

      const memberId = ctx.member.id as MemberId
      const userIdentifier = getMemberIdentifier(memberId)

      // Generate IP hash if not provided (for privacy-preserving storage)
      const ipHash =
        clientIpHash || hashIP('unknown', process.env.BETTER_AUTH_SECRET || 'default-salt')

      const result = await voteOnPost(postId, userIdentifier, {
        memberId,
        ipHash,
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      return result.value
    }
  )

/**
 * Create a post on a public board.
 */
export const createPublicPostFn = createServerFn({ method: 'POST' })
  .inputValidator(createPublicPostSchema)
  .handler(async ({ data }: { data: CreatePublicPostInput }) => {
    const ctx = await requireAuth()
    const { boardId: boardIdRaw, title, content, contentJson } = data
    const boardId = boardIdRaw as BoardId

    // Get board and verify it exists and is public
    const boardResult = await getPublicBoardById(boardId)
    if (!boardResult.success || !boardResult.value.isPublic) {
      throw new Error('Board not found')
    }
    const board = boardResult.value

    // Get member record (re-query for full details)
    const memberResult = await getMemberByUser(ctx.user.id as UserId)
    if (!memberResult.success || !memberResult.value) {
      throw new Error('You must be a member to submit feedback.')
    }
    const memberRecord = memberResult.value

    // Build author info
    const author = {
      memberId: memberRecord.id as MemberId,
      name: ctx.user.name || ctx.user.email,
      email: ctx.user.email,
    }

    // Get default status
    const defaultStatusResult = await getDefaultStatus()
    if (!defaultStatusResult.success) {
      throw new Error('Failed to retrieve default status')
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
      throw new Error(createResult.error.message)
    }

    const post = createResult.value

    // Get settings for organization info
    const settings = await getSettings()
    if (!settings) {
      throw new Error('Organization settings not found')
    }

    // Dispatch post.created event (fire-and-forget)
    dispatchPostCreated(
      { type: 'user', userId: ctx.user.id as UserId, email: ctx.user.email },
      {
        id: post.id,
        title: post.title,
        content: post.content,
        boardId: post.boardId,
        boardSlug: board.slug,
        authorEmail: ctx.user.email,
        voteCount: post.voteCount,
      }
    )

    return {
      id: post.id,
      title: post.title,
      content: post.content,
      statusId: post.statusId,
      voteCount: post.voteCount,
      createdAt: post.createdAt.toISOString(),
      board: {
        id: board.id,
        name: board.name,
        slug: board.slug,
      },
    }
  })

/**
 * Get all post IDs the user has voted on (optional auth).
 */
export const getVotedPostsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ votedPostIds: string[] }> => {
    const ctx = await getOptionalAuth()

    // Optional auth - return empty if not authenticated
    if (!ctx.user || !ctx.member) {
      return { votedPostIds: [] }
    }

    const userIdentifier = getMemberIdentifier(ctx.member.id)
    const result = await getAllUserVotedPostIds(userIdentifier)

    if (!result.success) {
      return { votedPostIds: [] }
    }

    return { votedPostIds: Array.from(result.value) }
  }
)

/**
 * List public roadmaps for a workspace (no auth required).
 */
export const listPublicRoadmapsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await getOptionalAuth()

  const result = await listPublicRoadmaps()
  if (!result.success) {
    throw new Error(result.error.message)
  }

  // Serialize Date fields
  return result.value.map((roadmap) => ({
    ...roadmap,
    createdAt: roadmap.createdAt.toISOString(),
    updatedAt: roadmap.updatedAt.toISOString(),
  }))
})

/**
 * Get posts for a public roadmap (no auth required).
 */
export const getPublicRoadmapPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(getPublicRoadmapPostsSchema)
  .handler(async ({ data }: { data: GetPublicRoadmapPostsInput }) => {
    await getOptionalAuth()

    const { roadmapId, statusId, limit, offset } = data

    const result = await getPublicRoadmapPosts(roadmapId as RoadmapId, {
      statusId: statusId as StatusId | undefined,
      limit,
      offset,
    })

    if (!result.success) {
      throw new Error(result.error.message)
    }

    return result.value
  })

/**
 * Get paginated posts for roadmap view filtered by status (legacy).
 */
export const getRoadmapPostsByStatusFn = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapPostsByStatusSchema)
  .handler(async ({ data }: { data: GetRoadmapPostsByStatusInput }) => {
    await getOptionalAuth()

    const { statusId, page, limit } = data

    const result = await getPublicRoadmapPostsPaginated({
      statusId: statusId as StatusId,
      page,
      limit,
    })

    if (!result.success) {
      throw new Error(result.error.message)
    }

    return result.value
  })

/**
 * Get vote sidebar data for a post (optional auth).
 * Returns user identifier, membership status, vote status, and subscription status.
 */
export const getVoteSidebarDataFn = createServerFn({ method: 'GET' })
  .inputValidator(getVoteSidebarDataSchema)
  .handler(
    async ({
      data,
    }: {
      data: GetVoteSidebarDataInput
    }): Promise<{
      userIdentifier: string
      isMember: boolean
      hasVoted: boolean
      subscriptionStatus: { subscribed: boolean; muted: boolean; reason: SubscriptionReason | null }
    }> => {
      const ctx = await getOptionalAuth()
      const postId = data.postId as PostId

      let userIdentifier = ''
      let isMember = false
      let hasVoted = false
      let subscriptionStatus: {
        subscribed: boolean
        muted: boolean
        reason: SubscriptionReason | null
      } = {
        subscribed: false,
        muted: false,
        reason: null,
      }

      // If user is authenticated and is a member
      if (ctx.user && ctx.member) {
        userIdentifier = getMemberIdentifier(ctx.member.id)
        isMember = true

        // Check if user has voted
        const voteResult = await hasUserVoted(postId, userIdentifier)
        hasVoted = voteResult.success ? voteResult.value : false

        // Get subscription status
        subscriptionStatus = await getSubscriptionStatus(ctx.member.id, postId)
      }

      return {
        userIdentifier,
        isMember,
        hasVoted,
        subscriptionStatus,
      }
    }
  )
