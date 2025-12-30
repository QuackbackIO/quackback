import { createServerFn } from '@tanstack/react-start'
import { listPublicPosts, getUserVotedPostIds } from '@/lib/posts'
import { listPublicBoardsWithStats } from '@/lib/boards'
import { listPublicStatuses } from '@/lib/statuses'
import { listPublicTags } from '@/lib/tags'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import type { PostId, MemberId } from '@quackback/ids'

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
    settings: (b.settings ?? {}) as Record<string, unknown>,
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
