import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getOptionalAuth } from './auth-helpers'
import { listPublicPosts, getUserVotedPostIds, hasUserVoted } from '@/lib/posts'
import { listPublicBoardsWithStats } from '@/lib/boards'
import { listPublicStatuses } from '@/lib/statuses'
import { listPublicTags } from '@/lib/tags'
import { listPublicRoadmaps, getPublicRoadmapPosts } from '@/lib/roadmaps'
import { getSubscriptionStatus } from '@/lib/subscriptions'
import { db, member as memberTable, user as userTable, eq, inArray } from '@/lib/db'
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

export const fetchPublicBoards = createServerFn({ method: 'GET' }).handler(async () => {
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

export const fetchPublicPosts = createServerFn({ method: 'GET' })
  .inputValidator(fetchPublicPostsSchema)
  .handler(
    async ({
      data,
    }: {
      data: { boardSlug?: string; search?: string; sort: 'top' | 'new' | 'trending' }
    }) => {
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
  const result = await listPublicStatuses()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

export const fetchPublicTags = createServerFn({ method: 'GET' }).handler(async () => {
  const result = await listPublicTags()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

export const fetchVotedPosts = createServerFn({ method: 'GET' })
  .inputValidator(fetchVotedPostsSchema)
  .handler(async ({ data }) => {
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
    const result = await hasUserVoted(data.postId as PostId, data.userIdentifier)
    return result.success ? result.value : false
  })

/**
 * Get subscription status for a member and post
 */
export const fetchSubscriptionStatus = createServerFn({ method: 'GET' })
  .inputValidator(fetchSubscriptionStatusSchema)
  .handler(async ({ data }) => {
    return await getSubscriptionStatus(data.memberId as MemberId, data.postId as PostId)
  })

/**
 * Fetch all public roadmaps
 */
export const fetchPublicRoadmaps = createServerFn({ method: 'GET' }).handler(async () => {
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
      user: { name: string | null; email: string } | undefined
    }> => {
      const ctx = await getOptionalAuth()

      let isMember = false
      let user: { name: string | null; email: string } | undefined = undefined

      // If user is authenticated and is a member
      if (ctx.user && ctx.member) {
        isMember = true
        user = {
          name: ctx.user.name,
          email: ctx.user.email,
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
