/**
 * Server functions for public post operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  type PostId,
  type BoardId,
  type StatusId,
  type TagId,
  type MemberId,
  type RoadmapId,
  type UserId,
} from '@quackback/ids'
import { getOptionalAuth, requireAuth } from './auth-helpers'
import { getSettings } from './workspace'
import {
  listPublicPosts,
  hasUserVoted,
  getAllUserVotedPostIds,
  getPublicRoadmapPostsPaginated,
} from '@/lib/posts/post.public'
import {
  canEditPost,
  canDeletePost,
  userEditPost,
  softDeletePost,
  voteOnPost,
  createPost,
} from '@/lib/posts/post.service'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { getPublicBoardById } from '@/lib/boards/board.public'
import { getDefaultStatus } from '@/lib/statuses/status.service'
import { getMemberByUser } from '@/lib/members/member.service'
import { dispatchPostCreated } from '@/lib/events/dispatch'
import { listPublicRoadmaps, getPublicRoadmapPosts } from '@/lib/roadmaps/roadmap.service'
import { getSubscriptionStatus } from '@/lib/subscriptions/subscription.service'

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
  statusIds: z.array(z.string()).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  sort: z.enum(['top', 'new', 'trending']).optional().default('top'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

const getPostPermissionsSchema = z.object({
  postId: z.string(),
})

const userEditPostSchema = z.object({
  postId: z.string(),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required').max(10000),
  contentJson: tiptapContentSchema.optional(),
})

const userDeletePostSchema = z.object({
  postId: z.string(),
})

const toggleVoteSchema = z.object({
  postId: z.string(),
})

const createPublicPostSchema = z.object({
  boardId: z.string(),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000),
  contentJson: tiptapContentSchema.optional(),
})

const getPublicRoadmapPostsSchema = z.object({
  roadmapId: z.string(),
  statusId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
})

const getRoadmapPostsByStatusSchema = z.object({
  statusId: z.string(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(10),
})

const getVoteSidebarDataSchema = z.object({
  postId: z.string(),
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
    console.log(
      `[fn:public-posts] listPublicPostsFn: sort=${data.sort}, board=${data.boardSlug || 'all'}`
    )
    try {
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

      console.log(`[fn:public-posts] listPublicPostsFn: count=${result.items.length}`)
      // Serialize Date fields
      return {
        ...result,
        items: result.items.map((post) => ({
          ...post,
          createdAt: post.createdAt.toISOString(),
        })),
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ listPublicPostsFn failed:`, error)
      throw error
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
      console.log(`[fn:public-posts] getPostPermissionsFn: postId=${data.postId}`)
      try {
        const ctx = await getOptionalAuth()
        const postId = data.postId as PostId

        // If no user/member, return no permissions
        if (!ctx?.user || !ctx?.member) {
          console.log(`[fn:public-posts] getPostPermissionsFn: no auth context`)
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

        console.log(
          `[fn:public-posts] getPostPermissionsFn: canEdit=${editResult.allowed}, canDelete=${deleteResult.allowed}`
        )
        return {
          canEdit: editResult.allowed,
          canDelete: deleteResult.allowed,
          editReason: editResult.reason,
          deleteReason: deleteResult.reason,
        }
      } catch (error) {
        // Post not found or other error - return no permissions
        console.error(`[fn:public-posts] ❌ getPostPermissionsFn failed:`, error)
        return { canEdit: false, canDelete: false }
      }
    }
  )

/**
 * User edits their own post.
 */
export const userEditPostFn = createServerFn({ method: 'POST' })
  .inputValidator(userEditPostSchema)
  .handler(async ({ data }: { data: UserEditPostInput }) => {
    console.log(`[fn:public-posts] userEditPostFn: postId=${data.postId}`)
    try {
      const ctx = await requireAuth()
      const { postId: postIdRaw, title, content, contentJson } = data
      const postId = postIdRaw as PostId

      // Build actor info for permission check
      const actor = {
        memberId: ctx.member.id,
        role: ctx.member.role,
      }

      const result = await userEditPost(postId, { title, content, contentJson }, actor)

      console.log(`[fn:public-posts] userEditPostFn: edited id=${result.id}`)
      // Serialize Date fields
      return {
        ...result,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        deletedAt: result.deletedAt?.toISOString() || null,
        officialResponseAt: result.officialResponseAt?.toISOString() || null,
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ userEditPostFn failed:`, error)
      throw error
    }
  })

/**
 * User soft-deletes their own post.
 */
export const userDeletePostFn = createServerFn({ method: 'POST' })
  .inputValidator(userDeletePostSchema)
  .handler(async ({ data }: { data: UserDeletePostInput }) => {
    console.log(`[fn:public-posts] userDeletePostFn: postId=${data.postId}`)
    try {
      const ctx = await requireAuth()
      const postId = data.postId as PostId

      // Build actor info for permission check
      const actor = {
        memberId: ctx.member.id,
        role: ctx.member.role,
      }

      await softDeletePost(postId, actor)

      console.log(`[fn:public-posts] userDeletePostFn: deleted id=${postId}`)
      return { id: postId }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ userDeletePostFn failed:`, error)
      throw error
    }
  })

/**
 * Toggle vote on a post.
 */
export const toggleVoteFn = createServerFn({ method: 'POST' })
  .inputValidator(toggleVoteSchema)
  .handler(
    async ({ data }: { data: ToggleVoteInput }): Promise<{ voted: boolean; voteCount: number }> => {
      console.log(`[fn:public-posts] toggleVoteFn: postId=${data.postId}`)
      try {
        const ctx = await requireAuth()
        const postId = data.postId as PostId

        const memberId = ctx.member.id as MemberId
        const userIdentifier = getMemberIdentifier(memberId)

        const result = await voteOnPost(postId, userIdentifier, {
          memberId,
        })
        console.log(
          `[fn:public-posts] toggleVoteFn: voted=${result.voted}, count=${result.voteCount}`
        )
        return result
      } catch (error) {
        console.error(`[fn:public-posts] ❌ toggleVoteFn failed:`, error)
        throw error
      }
    }
  )

/**
 * Create a post on a public board.
 */
export const createPublicPostFn = createServerFn({ method: 'POST' })
  .inputValidator(createPublicPostSchema)
  .handler(async ({ data }: { data: CreatePublicPostInput }) => {
    console.log(`[fn:public-posts] createPublicPostFn: boardId=${data.boardId}`)
    try {
      const ctx = await requireAuth()
      const { boardId: boardIdRaw, title, content, contentJson } = data
      const boardId = boardIdRaw as BoardId

      // Get board and verify it exists and is public
      const board = await getPublicBoardById(boardId)
      if (!board || !board.isPublic) {
        throw new Error('Board not found')
      }

      // Get member record (re-query for full details)
      const memberRecord = await getMemberByUser(ctx.user.id as UserId)
      if (!memberRecord) {
        throw new Error('You must be a member to submit feedback.')
      }

      // Build author info
      const author = {
        memberId: memberRecord.id as MemberId,
        name: ctx.user.name || ctx.user.email,
        email: ctx.user.email,
      }

      // Get default status
      const defaultStatus = await getDefaultStatus()

      // Create the post
      const post = await createPost(
        {
          boardId,
          title,
          content,
          contentJson,
          statusId: defaultStatus?.id,
        },
        author
      )

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

      console.log(`[fn:public-posts] createPublicPostFn: id=${post.id}`)
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
    } catch (error) {
      console.error(`[fn:public-posts] ❌ createPublicPostFn failed:`, error)
      throw error
    }
  })

/**
 * Get all post IDs the user has voted on (optional auth).
 */
export const getVotedPostsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ votedPostIds: string[] }> => {
    console.log(`[fn:public-posts] getVotedPostsFn`)
    try {
      const ctx = await getOptionalAuth()

      // Optional auth - return empty if not authenticated
      if (!ctx?.user || !ctx?.member) {
        console.log(`[fn:public-posts] getVotedPostsFn: no auth`)
        return { votedPostIds: [] }
      }

      const userIdentifier = getMemberIdentifier(ctx.member.id)
      const result = await getAllUserVotedPostIds(userIdentifier)

      console.log(`[fn:public-posts] getVotedPostsFn: count=${result.size}`)
      return { votedPostIds: Array.from(result) }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ getVotedPostsFn failed:`, error)
      throw error
    }
  }
)

/**
 * List public roadmaps for a workspace (no auth required).
 */
export const listPublicRoadmapsFn = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:public-posts] listPublicRoadmapsFn`)
  try {
    await getOptionalAuth()

    const result = await listPublicRoadmaps()

    console.log(`[fn:public-posts] listPublicRoadmapsFn: count=${result.length}`)
    // Serialize branded types to plain strings for turbo-stream
    return result.map((roadmap) => ({
      id: String(roadmap.id),
      name: roadmap.name,
      slug: roadmap.slug,
      description: roadmap.description,
      isPublic: roadmap.isPublic,
      position: roadmap.position,
      createdAt: roadmap.createdAt.toISOString(),
      updatedAt: roadmap.updatedAt.toISOString(),
    }))
  } catch (error) {
    console.error(`[fn:public-posts] ❌ listPublicRoadmapsFn failed:`, error)
    throw error
  }
})

/**
 * Get posts for a public roadmap (no auth required).
 */
export const getPublicRoadmapPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(getPublicRoadmapPostsSchema)
  .handler(async ({ data }: { data: GetPublicRoadmapPostsInput }) => {
    console.log(`[fn:public-posts] getPublicRoadmapPostsFn: roadmapId=${data.roadmapId}`)
    try {
      await getOptionalAuth()

      const { roadmapId, statusId, limit, offset } = data

      const result = await getPublicRoadmapPosts(roadmapId as RoadmapId, {
        statusId: statusId as StatusId | undefined,
        limit,
        offset,
      })
      console.log(`[fn:public-posts] getPublicRoadmapPostsFn: count=${result.items.length}`)

      // Serialize branded types to plain strings for turbo-stream
      return {
        ...result,
        items: result.items.map((item) => ({
          id: String(item.id),
          title: item.title,
          voteCount: item.voteCount,
          statusId: item.statusId ? String(item.statusId) : null,
          board: {
            id: String(item.board.id),
            name: item.board.name,
            slug: item.board.slug,
          },
          roadmapEntry: {
            postId: String(item.roadmapEntry.postId),
            roadmapId: String(item.roadmapEntry.roadmapId),
            position: item.roadmapEntry.position,
          },
        })),
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ getPublicRoadmapPostsFn failed:`, error)
      throw error
    }
  })

/**
 * Get paginated posts for roadmap view filtered by status (legacy).
 */
export const getRoadmapPostsByStatusFn = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapPostsByStatusSchema)
  .handler(async ({ data }: { data: GetRoadmapPostsByStatusInput }) => {
    console.log(`[fn:public-posts] getRoadmapPostsByStatusFn: statusId=${data.statusId}`)
    try {
      await getOptionalAuth()

      const { statusId, page, limit } = data

      const result = await getPublicRoadmapPostsPaginated({
        statusId: statusId as StatusId,
        page,
        limit,
      })
      console.log(`[fn:public-posts] getRoadmapPostsByStatusFn: count=${result.items.length}`)

      // Serialize branded types to plain strings for turbo-stream
      return {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          statusId: item.statusId ? String(item.statusId) : null,
        })),
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ getRoadmapPostsByStatusFn failed:`, error)
      throw error
    }
  })

/**
 * Get vote sidebar data for a post (optional auth).
 * Returns membership status, vote status, and subscription status.
 */
export const getVoteSidebarDataFn = createServerFn({ method: 'GET' })
  .inputValidator(getVoteSidebarDataSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:public-posts] getVoteSidebarDataFn: postId=${data.postId}`)
    try {
      const ctx = await getOptionalAuth()
      const postId = data.postId as PostId

      let isMember = false
      let hasVoted = false
      let subscriptionStatus: {
        subscribed: boolean
        muted: boolean
        reason: string | null
      } = {
        subscribed: false,
        muted: false,
        reason: null,
      }

      if (ctx?.user && ctx?.member) {
        const userIdentifier = getMemberIdentifier(ctx.member.id)
        isMember = true

        hasVoted = await hasUserVoted(postId, userIdentifier)

        subscriptionStatus = await getSubscriptionStatus(ctx.member.id, postId)
      }

      console.log(
        `[fn:public-posts] getVoteSidebarDataFn: isMember=${isMember}, hasVoted=${hasVoted}`
      )
      return {
        isMember,
        hasVoted,
        subscriptionStatus,
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ getVoteSidebarDataFn failed:`, error)
      throw error
    }
  })
