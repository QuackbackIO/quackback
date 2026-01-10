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
import { getOptionalAuth } from './auth-helpers'
import { db, member as memberTable, user as userTable, eq, inArray } from '@/lib/db'
import { listPublicBoardsWithStats, getPublicBoardBySlug } from '@/lib/boards/board.public'
import {
  getPublicPostDetail,
  listPublicPosts,
  getUserVotedPostIds,
  hasUserVoted,
} from '@/lib/posts/post.public'
import { listPublicStatuses } from '@/lib/statuses/status.service'
import { listPublicTags } from '@/lib/tags/tag.service'
import { getSubscriptionStatus } from '@/lib/subscriptions/subscription.service'
import { listPublicRoadmaps, getPublicRoadmapPosts } from '@/lib/roadmaps/roadmap.service'
import { getMemberIdentifier } from '@/lib/user-identifier'

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
    console.log(`[fn:portal] getMemberIdForUser: userId=${data.userId}`)
    try {
      const memberRecord = await db.query.member.findFirst({
        where: eq(memberTable.userId, data.userId as UserId),
      })

      console.log(`[fn:portal] getMemberIdForUser: found=${!!memberRecord}`)
      return memberRecord?.id ?? null
    } catch (error) {
      console.error(`[fn:portal] ❌ getMemberIdForUser failed:`, error)
      throw error
    }
  })

export const fetchPublicBoards = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:portal] fetchPublicBoards`)
  try {
    const result = await listPublicBoardsWithStats()
    console.log(`[fn:portal] fetchPublicBoards: count=${result.length}`)
    // Serialize settings field for client
    return result.map((b) => ({
      ...b,
      settings: (b.settings ?? {}) as BoardSettings,
    }))
  } catch (error) {
    console.error(`[fn:portal] ❌ fetchPublicBoards failed:`, error)
    throw error
  }
})

const fetchPublicBoardBySlugSchema = z.object({
  slug: z.string(),
})

export const fetchPublicBoardBySlug = createServerFn({ method: 'GET' })
  .inputValidator(fetchPublicBoardBySlugSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:portal] fetchPublicBoardBySlug: slug=${data.slug}`)
    try {
      const result = await getPublicBoardBySlug(data.slug)
      console.log(`[fn:portal] fetchPublicBoardBySlug: found=${!!result}`)
      if (!result) {
        return null
      }
      return {
        ...result,
        settings: (result.settings ?? {}) as BoardSettings,
      }
    } catch (error) {
      console.error(`[fn:portal] ❌ fetchPublicBoardBySlug failed:`, error)
      throw error
    }
  })

const fetchPublicPostDetailSchema = z.object({
  postId: z.string(),
})

export const fetchPublicPostDetail = createServerFn({ method: 'GET' })
  .inputValidator(fetchPublicPostDetailSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:portal] fetchPublicPostDetail: postId=${data.postId}`)
    try {
      // Get user identifier for reaction highlighting (optional auth)
      const ctx = await getOptionalAuth()
      const userIdentifier = ctx?.member ? getMemberIdentifier(ctx.member.id) : undefined

      const result = await getPublicPostDetail(data.postId as PostId, userIdentifier)
      if (!result) {
        return null
      }

      // Helper to serialize comment dates recursively
      type CommentType = (typeof result.comments)[0]
      type SerializedComment = Omit<CommentType, 'createdAt' | 'replies'> & {
        createdAt: string
        replies: SerializedComment[]
      }
      const serializeComment = (c: CommentType): SerializedComment => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        replies: c.replies.map(serializeComment),
      })

      // Serialize Date fields
      console.log(`[fn:portal] fetchPublicPostDetail: found, comments=${result.comments.length}`)
      return {
        ...result,
        contentJson: result.contentJson ?? {},
        createdAt: result.createdAt.toISOString(),
        comments: result.comments.map(serializeComment),
        officialResponse: result.officialResponse
          ? {
              ...result.officialResponse,
              respondedAt: result.officialResponse.respondedAt.toISOString(),
            }
          : null,
      }
    } catch (error) {
      console.error(`[fn:portal] ❌ fetchPublicPostDetail failed:`, error)
      throw error
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
      console.log(
        `[fn:portal] fetchPublicPosts: sort=${data.sort}, board=${data.boardSlug || 'all'}`
      )
      try {
        const result = await listPublicPosts({
          boardSlug: data.boardSlug,
          search: data.search,
          sort: data.sort,
          page: 1,
          limit: 20,
        })
        console.log(`[fn:portal] fetchPublicPosts: count=${result.items.length}`)
        // Serialize Date fields
        return {
          ...result,
          items: result.items.map((post) => ({
            ...post,
            createdAt: post.createdAt.toISOString(),
          })),
        }
      } catch (error) {
        console.error(`[fn:portal] ❌ fetchPublicPosts failed:`, error)
        throw error
      }
    }
  )

export const fetchPublicStatuses = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:portal] fetchPublicStatuses`)
  try {
    const result = await listPublicStatuses()
    console.log(`[fn:portal] fetchPublicStatuses: count=${result.length}`)
    return result
  } catch (error) {
    console.error(`[fn:portal] ❌ fetchPublicStatuses failed:`, error)
    throw error
  }
})

export const fetchPublicTags = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:portal] fetchPublicTags`)
  try {
    const result = await listPublicTags()
    console.log(`[fn:portal] fetchPublicTags: count=${result.length}`)
    return result
  } catch (error) {
    console.error(`[fn:portal] ❌ fetchPublicTags failed:`, error)
    throw error
  }
})

export const fetchVotedPosts = createServerFn({ method: 'GET' })
  .inputValidator(fetchVotedPostsSchema)
  .handler(async ({ data }) => {
    const result = await getUserVotedPostIds(data.postIds as PostId[], data.userIdentifier)
    return Array.from(result)
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
    return await hasUserVoted(data.postId as PostId, data.userIdentifier)
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
  console.log(`[fn:portal] fetchPublicRoadmaps`)
  try {
    const roadmaps = await listPublicRoadmaps()
    console.log(`[fn:portal] fetchPublicRoadmaps: count=${roadmaps.length}`)
    // Serialize branded types to plain strings for turbo-stream
    return roadmaps.map((roadmap) => ({
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
    console.error(`[fn:portal] ❌ fetchPublicRoadmaps failed:`, error)
    throw error
  }
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
