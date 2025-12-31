import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { listPublicPosts, getUserVotedPostIds } from '@/lib/posts'
import { listPublicBoardsWithStats } from '@/lib/boards'
import { listPublicStatuses } from '@/lib/statuses'
import { listPublicTags } from '@/lib/tags'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { listPublicRoadmaps, getPublicRoadmapPosts } from '@/lib/roadmaps'
import {
  postIdSchema,
  memberIdSchema,
  roadmapIdSchema,
  statusIdSchema,
  type PostId,
  type MemberId,
  type RoadmapId,
  type StatusId,
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
  postIds: z.array(postIdSchema),
  userIdentifier: z.string(),
})

const fetchAvatarsSchema = z.array(memberIdSchema)

const checkUserVotedSchema = z.object({
  postId: postIdSchema,
  userIdentifier: z.string(),
})

const fetchSubscriptionStatusSchema = z.object({
  memberId: memberIdSchema,
  postId: postIdSchema,
})

const fetchPublicRoadmapPostsSchema = z.object({
  roadmapId: roadmapIdSchema,
  statusId: statusIdSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
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
  .handler(async ({ data }: { data: { postIds: PostId[]; userIdentifier: string } }) => {
    const result = await getUserVotedPostIds(data.postIds, data.userIdentifier)
    if (!result.success) {
      return []
    }
    return Array.from(result.value)
  })

export const fetchAvatars = createServerFn({ method: 'GET' })
  .inputValidator(fetchAvatarsSchema)
  .handler(async ({ data }: { data: MemberId[] }) => {
    const avatarMap = await getBulkMemberAvatarData(data)
    return Object.fromEntries(avatarMap)
  })

/**
 * Check if a user has voted on a post
 */
export const checkUserVoted = createServerFn({ method: 'GET' })
  .inputValidator(checkUserVotedSchema)
  .handler(async ({ data }: { data: { postId: PostId; userIdentifier: string } }) => {
    const { hasUserVoted } = await import('@/lib/posts')
    const result = await hasUserVoted(data.postId, data.userIdentifier)
    return result.success ? result.value : false
  })

/**
 * Get subscription status for a member and post
 */
export const fetchSubscriptionStatus = createServerFn({ method: 'GET' })
  .inputValidator(fetchSubscriptionStatusSchema)
  .handler(async ({ data }: { data: { memberId: MemberId; postId: PostId } }) => {
    const { getSubscriptionStatus } = await import('@/lib/subscriptions')
    return await getSubscriptionStatus(data.memberId, data.postId)
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
  .handler(
    async ({
      data,
    }: {
      data: { roadmapId: RoadmapId; statusId?: StatusId; limit?: number; offset?: number }
    }) => {
      const result = await getPublicRoadmapPosts(data.roadmapId, {
        statusId: data.statusId,
        limit: data.limit ?? 20,
        offset: data.offset ?? 0,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.value
    }
  )
