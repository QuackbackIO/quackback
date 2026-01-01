import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  type PostId,
  type MemberId,
  type RoadmapId,
  type StatusId,
  type UserId,
} from '@quackback/ids'
import type { BoardSettings } from '@quackback/db/types'

/**
 * Server functions for portal/public data fetching.
 * These functions allow unauthenticated access for public portal use.
 *
 * NOTE: All DB and server-only imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 */

// ============================================
// Schemas
// ============================================

const fetchPublicPostsSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['top', 'new', 'trending']),
})

const fetchVotedPostsSchema = z.object({
  postIds: z.array(z.string()),
  userIdentifier: z.string(),
})

const fetchAvatarsSchema = z.array(z.string())

const fetchUserAvatarSchema = z.object({
  userId: z.string(),
  fallbackImageUrl: z.string().nullable().optional(),
})

const checkUserVotedSchema = z.object({
  postId: z.string(),
  userIdentifier: z.string(),
})

const fetchSubscriptionStatusSchema = z.object({
  memberId: z.string(),
  postId: z.string(),
})

const fetchPublicRoadmapPostsSchema = z.object({
  roadmapId: z.string(),
  statusId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
})

const getCommentsSectionDataSchema = z.object({
  commentMemberIds: z.array(z.string()),
})

const getMemberIdForUserSchema = z.object({
  userId: z.string(),
})

/**
 * Get the member ID for a user.
 * Used in loaders to get member identifier for authenticated users.
 */
export const getMemberIdForUser = createServerFn({ method: 'GET' })
  .inputValidator(getMemberIdForUserSchema)
  .handler(async ({ data }): Promise<MemberId | null> => {
    const { db, member, eq } = await import('@/lib/db')

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, data.userId),
    })

    return memberRecord?.id ?? null
  })

export const fetchPublicBoards = createServerFn({ method: 'GET' }).handler(async () => {
  const { listPublicBoardsWithStats } = await import('@/lib/boards/board.public')

  const result = await listPublicBoardsWithStats()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  // Serialize settings field for client
  return result.value.map((b) => ({
    ...b,
    settings: (b.settings ?? {}) as BoardSettings,
  }))
})

const fetchPublicBoardBySlugSchema = z.object({
  slug: z.string(),
})

export const fetchPublicBoardBySlug = createServerFn({ method: 'GET' })
  .inputValidator(fetchPublicBoardBySlugSchema)
  .handler(async ({ data }) => {
    const { getPublicBoardBySlug } = await import('@/lib/boards/board.public')

    const result = await getPublicBoardBySlug(data.slug)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    if (!result.value) {
      return null
    }
    return {
      ...result.value,
      settings: (result.value.settings ?? {}) as BoardSettings,
    }
  })

const fetchPublicPostDetailSchema = z.object({
  postId: z.string(),
})

export const fetchPublicPostDetail = createServerFn({ method: 'GET' })
  .inputValidator(fetchPublicPostDetailSchema)
  .handler(async ({ data }) => {
    const { getOptionalAuth } = await import('./auth-helpers')
    const { getPublicPostDetail } = await import('@/lib/posts/post.public')
    const { getMemberIdentifier } = await import('@/lib/user-identifier')

    // Get user identifier for reaction highlighting (optional auth)
    const ctx = await getOptionalAuth()
    const userIdentifier = ctx?.member ? getMemberIdentifier(ctx.member.id) : undefined

    const result = await getPublicPostDetail(data.postId as PostId, userIdentifier)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    if (!result.value) {
      return null
    }

    // Helper to serialize comment dates recursively
    const serializeComment = (c: (typeof result.value.comments)[0]): unknown => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      replies: c.replies.map(serializeComment),
    })

    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      comments: result.value.comments.map(serializeComment),
      officialResponse: result.value.officialResponse
        ? {
            ...result.value.officialResponse,
            respondedAt: result.value.officialResponse.respondedAt.toISOString(),
          }
        : null,
    }
  })

export const fetchPublicPosts = createServerFn({ method: 'GET' })
  .inputValidator(fetchPublicPostsSchema)
  .handler(
    async ({
      data,
    }: {
      data: { boardSlug?: string; search?: string; sort: 'top' | 'new' | 'trending' }
    }) => {
      const { listPublicPosts } = await import('@/lib/posts/post.public')

      const result = await listPublicPosts({
        boardSlug: data.boardSlug,
        search: data.search,
        sort: data.sort,
        page: 1,
        limit: 20,
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
    }
  )

export const fetchPublicStatuses = createServerFn({ method: 'GET' }).handler(async () => {
  const { listPublicStatuses } = await import('@/lib/statuses/status.service')

  const result = await listPublicStatuses()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

export const fetchPublicTags = createServerFn({ method: 'GET' }).handler(async () => {
  const { listPublicTags } = await import('@/lib/tags/tag.service')

  const result = await listPublicTags()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

export const fetchVotedPosts = createServerFn({ method: 'GET' })
  .inputValidator(fetchVotedPostsSchema)
  .handler(async ({ data }) => {
    const { getUserVotedPostIds } = await import('@/lib/posts/post.public')

    const result = await getUserVotedPostIds(data.postIds as PostId[], data.userIdentifier)
    if (!result.success) {
      return []
    }
    return Array.from(result.value)
  })

/**
 * Fetch avatar for a single user
 */
export const fetchUserAvatar = createServerFn({ method: 'GET' })
  .inputValidator(fetchUserAvatarSchema)
  .handler(async ({ data }) => {
    const { db, user: userTable, eq } = await import('@/lib/db')

    const { userId, fallbackImageUrl } = data

    const userRecord = await db.query.user.findFirst({
      where: eq(userTable.id, userId as UserId),
      columns: {
        imageBlob: true,
        imageType: true,
        image: true,
      },
    })

    if (!userRecord) {
      return { avatarUrl: fallbackImageUrl ?? null, hasCustomAvatar: false }
    }

    // Custom blob avatar takes precedence
    if (userRecord.imageBlob && userRecord.imageType) {
      const base64 = Buffer.from(userRecord.imageBlob).toString('base64')
      return {
        avatarUrl: `data:${userRecord.imageType};base64,${base64}`,
        hasCustomAvatar: true,
      }
    }

    // Fall back to OAuth image URL
    return {
      avatarUrl: userRecord.image ?? fallbackImageUrl ?? null,
      hasCustomAvatar: false,
    }
  })

/**
 * Fetch avatars for multiple members
 */
export const fetchAvatars = createServerFn({ method: 'GET' })
  .inputValidator(fetchAvatarsSchema)
  .handler(async ({ data }) => {
    const { db, member: memberTable, user: userTable, eq, inArray } = await import('@/lib/db')

    // Filter out nulls and cast to MemberId
    const validMemberIds = (data as MemberId[]).filter((id): id is MemberId => id !== null)

    if (validMemberIds.length === 0) {
      return {}
    }

    // Get members with their user data
    const members = await db
      .select({
        memberId: memberTable.id,
        userId: memberTable.userId,
        imageBlob: userTable.imageBlob,
        imageType: userTable.imageType,
        image: userTable.image,
      })
      .from(memberTable)
      .innerJoin(userTable, eq(memberTable.userId, userTable.id))
      .where(inArray(memberTable.id, validMemberIds))

    const avatarMap = new Map<MemberId, string | null>()

    for (const member of members) {
      if (member.imageBlob && member.imageType) {
        const base64 = Buffer.from(member.imageBlob).toString('base64')
        avatarMap.set(member.memberId, `data:${member.imageType};base64,${base64}`)
      } else {
        avatarMap.set(member.memberId, member.image)
      }
    }

    // Fill in null for any members not found
    for (const memberId of validMemberIds) {
      if (!avatarMap.has(memberId)) {
        avatarMap.set(memberId, null)
      }
    }

    return Object.fromEntries(avatarMap)
  })

/**
 * Check if a user has voted on a post
 */
export const checkUserVoted = createServerFn({ method: 'GET' })
  .inputValidator(checkUserVotedSchema)
  .handler(async ({ data }) => {
    const { hasUserVoted } = await import('@/lib/posts/post.public')

    const result = await hasUserVoted(data.postId as PostId, data.userIdentifier)
    return result.success ? result.value : false
  })

/**
 * Get subscription status for a member and post
 */
export const fetchSubscriptionStatus = createServerFn({ method: 'GET' })
  .inputValidator(fetchSubscriptionStatusSchema)
  .handler(async ({ data }) => {
    const { getSubscriptionStatus } = await import('@/lib/subscriptions/subscription.service')

    return await getSubscriptionStatus(data.memberId as MemberId, data.postId as PostId)
  })

/**
 * Fetch all public roadmaps
 */
export const fetchPublicRoadmaps = createServerFn({ method: 'GET' }).handler(async () => {
  const { listPublicRoadmaps } = await import('@/lib/roadmaps/roadmap.service')

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
 * Fetch posts for a specific roadmap + status combination
 */
export const fetchPublicRoadmapPosts = createServerFn({ method: 'GET' })
  .inputValidator(fetchPublicRoadmapPostsSchema)
  .handler(async ({ data }) => {
    const { getPublicRoadmapPosts } = await import('@/lib/roadmaps/roadmap.service')

    const result = await getPublicRoadmapPosts(data.roadmapId as RoadmapId, {
      statusId: data.statusId as StatusId | undefined,
      limit: data.limit ?? 20,
      offset: data.offset ?? 0,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })

/**
 * Get comments section data (optional auth).
 * Returns membership status and avatar URLs for comment authors.
 */
export const getCommentsSectionDataFn = createServerFn({ method: 'GET' })
  .inputValidator(getCommentsSectionDataSchema)
  .handler(
    async ({
      data,
    }): Promise<{
      isMember: boolean
      canComment: boolean
      commentAvatarMap: Record<string, string | null>
      user: { name: string | null; email: string; memberId?: MemberId } | undefined
    }> => {
      const { getOptionalAuth } = await import('./auth-helpers')
      const { db, member: memberTable, user: userTable, eq, inArray } = await import('@/lib/db')

      const ctx = await getOptionalAuth()

      let isMember = false
      let user: { name: string | null; email: string; memberId?: MemberId } | undefined = undefined

      if (ctx?.user && ctx?.member) {
        isMember = true
        user = {
          name: ctx.user.name,
          email: ctx.user.email,
          memberId: ctx.member.id,
        }
      }

      const canComment = isMember

      // Fetch avatar URLs for all comment authors
      const validMemberIds = (data.commentMemberIds as MemberId[]).filter(
        (id): id is MemberId => id !== null
      )
      let commentAvatarMap: Record<string, string | null> = {}

      if (validMemberIds.length > 0) {
        // Get members with their user data
        const members = await db
          .select({
            memberId: memberTable.id,
            userId: memberTable.userId,
            imageBlob: userTable.imageBlob,
            imageType: userTable.imageType,
            image: userTable.image,
          })
          .from(memberTable)
          .innerJoin(userTable, eq(memberTable.userId, userTable.id))
          .where(inArray(memberTable.id, validMemberIds))

        const avatarMap = new Map<MemberId, string | null>()

        for (const member of members) {
          if (member.imageBlob && member.imageType) {
            const base64 = Buffer.from(member.imageBlob).toString('base64')
            avatarMap.set(member.memberId, `data:${member.imageType};base64,${base64}`)
          } else {
            avatarMap.set(member.memberId, member.image)
          }
        }

        // Fill in null for any members not found
        for (const memberId of validMemberIds) {
          if (!avatarMap.has(memberId)) {
            avatarMap.set(memberId, null)
          }
        }

        commentAvatarMap = Object.fromEntries(avatarMap)
      }

      return {
        isMember,
        canComment,
        commentAvatarMap,
        user,
      }
    }
  )
