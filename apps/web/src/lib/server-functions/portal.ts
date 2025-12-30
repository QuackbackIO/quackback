import { createServerFn } from '@tanstack/react-start'
import { listPublicPosts, getUserVotedPostIds } from '@/lib/posts'
import { listPublicBoardsWithStats } from '@/lib/boards'
import { listPublicStatuses } from '@/lib/statuses'
import { listPublicTags } from '@/lib/tags'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { listPublicRoadmaps, getPublicRoadmapPosts } from '@/lib/roadmaps'
import type { PostId, MemberId, RoadmapId, StatusId } from '@quackback/ids'
import type { BoardSettings } from '@quackback/db/types'

/**
 * Server functions for portal/public data fetching.
 * These wrap service calls in createServerFn to keep database code server-only.
 */

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
  .inputValidator(
    (filters: { boardSlug?: string; search?: string; sort: 'top' | 'new' | 'trending' }) => filters
  )
  .handler(async ({ data: filters }) => {
    const result = await listPublicPosts({
      boardSlug: filters.boardSlug,
      search: filters.search,
      sort: filters.sort,
      page: 1,
      limit: 20,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })

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
  .inputValidator((params: { postIds: PostId[]; userIdentifier: string }) => params)
  .handler(async ({ data }) => {
    const result = await getUserVotedPostIds(data.postIds, data.userIdentifier)
    if (!result.success) {
      return []
    }
    return Array.from(result.value)
  })

export const fetchAvatars = createServerFn({ method: 'GET' })
  .inputValidator((memberIds: MemberId[]) => memberIds)
  .handler(async ({ data: memberIds }) => {
    const avatarMap = await getBulkMemberAvatarData(memberIds)
    return Object.fromEntries(avatarMap)
  })

/**
 * Check if a user has voted on a post
 */
export const checkUserVoted = createServerFn({ method: 'GET' })
  .inputValidator((params: { postId: PostId; userIdentifier: string }) => params)
  .handler(async ({ data }) => {
    const { hasUserVoted } = await import('@/lib/posts')
    const result = await hasUserVoted(data.postId, data.userIdentifier)
    return result.success ? result.value : false
  })

/**
 * Get subscription status for a member and post
 */
export const fetchSubscriptionStatus = createServerFn({ method: 'GET' })
  .inputValidator((params: { memberId: MemberId; postId: PostId }) => params)
  .handler(async ({ data }) => {
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
  return result.value
})

/**
 * Fetch posts for a specific roadmap + status combination
 */
export const fetchPublicRoadmapPosts = createServerFn({ method: 'GET' })
  .inputValidator(
    (params: { roadmapId: RoadmapId; statusId?: StatusId; limit?: number; offset?: number }) =>
      params
  )
  .handler(async ({ data }) => {
    const result = await getPublicRoadmapPosts(data.roadmapId, {
      statusId: data.statusId,
      limit: data.limit ?? 20,
      offset: data.offset ?? 0,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })
