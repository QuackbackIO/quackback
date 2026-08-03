import { queryOptions } from '@tanstack/react-query'
import type { PrincipalId, RoadmapId, StatusId, BoardId } from '@quackback/ids'
import type { RespondedFilter } from '@/lib/shared/types/filters'
import {
  fetchPublicBoards,
  fetchPublicPosts,
  fetchPublicStatuses,
  fetchPublicTags,
  fetchAvatars,
  fetchPublicRoadmaps,
  fetchPublicRoadmapPosts,
  fetchPortalData,
} from '@/lib/server/functions/portal'
import { ensureData } from '@/lib/client/query/ensure-data'

/**
 * Query options factory for portal/public routes.
 * Uses server functions (createServerFn) to keep database code server-only.
 * These are used with ensureQueryData() in loaders and useSuspenseQuery() in components.
 */
export const portalQueries = {
  /**
   * Combined portal data fetch - all data in a single server call.
   * This is the optimized entry point for the portal page.
   * Vote status is only shown for authenticated users (via userId -> principalId).
   */
  portalData: (params: {
    boardSlug?: string
    search?: string
    sort: 'top' | 'new' | 'trending'
    statusSlugs?: string[]
    tagIds?: string[]
    userId?: string
    minVotes?: number
    dateFrom?: string
    responded?: RespondedFilter
  }) =>
    queryOptions({
      queryKey: [
        'portal',
        'data',
        params.boardSlug,
        params.search,
        params.sort,
        params.statusSlugs,
        params.tagIds,
        params.userId,
        params.minVotes,
        params.dateFrom,
        params.responded,
      ],
      queryFn: async () => {
        const data = ensureData(await fetchPortalData({ data: params }), 'portalData')
        // Deserialize dates and cast branded types from server response
        return {
          ...data,
          posts: {
            ...data.posts,
            items: data.posts.items.map((p) => ({
              ...p,
              content: p.content ?? '', // Ensure content is never null
              createdAt: new Date(p.createdAt),
              principalId: p.principalId as PrincipalId | null, // Server returns string, cast to branded type
              board: p.board ? { ...p.board, id: p.board.id as BoardId } : undefined,
            })),
          },
        }
      },
    }),

  /**
   * List all public boards with post counts
   */
  boards: () =>
    queryOptions({
      queryKey: ['portal', 'boards'],
      queryFn: async () => ensureData(await fetchPublicBoards(), 'portalBoards'),
    }),

  /**
   * List posts for a board with filtering
   */
  posts: (filters: { boardSlug?: string; search?: string; sort: 'top' | 'new' | 'trending' }) =>
    queryOptions({
      queryKey: ['portal', 'posts', filters],
      queryFn: async () => ensureData(await fetchPublicPosts({ data: filters }), 'portalPosts'),
    }),

  /**
   * List all public statuses
   */
  statuses: () =>
    queryOptions({
      queryKey: ['portal', 'statuses'],
      queryFn: async () => ensureData(await fetchPublicStatuses(), 'portalStatuses'),
    }),

  /**
   * List all public tags
   */
  tags: () =>
    queryOptions({
      queryKey: ['portal', 'tags'],
      queryFn: async () => ensureData(await fetchPublicTags(), 'portalTags'),
    }),

  /**
   * Get bulk avatar data for post authors
   */
  avatars: (principalIds: PrincipalId[]) =>
    queryOptions({
      queryKey: ['portal', 'avatars', principalIds],
      queryFn: async () => ensureData(await fetchAvatars({ data: principalIds }), 'avatars'),
      // Avatars don't change often
      staleTime: 5 * 60 * 1000, // 5 minutes
    }),

  /**
   * List all public roadmaps
   */
  roadmaps: () =>
    queryOptions({
      queryKey: ['portal', 'roadmaps'],
      queryFn: async () => ensureData(await fetchPublicRoadmaps(), 'portalRoadmaps'),
      // Roadmaps don't change often
      staleTime: 2 * 60 * 1000, // 2 minutes
    }),

  /**
   * List posts for a roadmap column (roadmap + status combination)
   */
  roadmapPosts: (params: {
    roadmapId: RoadmapId
    statusId: StatusId
    limit?: number
    offset?: number
  }) =>
    queryOptions({
      // Don't include offset/limit in query key to allow cache sharing with infinite queries
      queryKey: ['portal', 'roadmapPosts', params.roadmapId, params.statusId],
      queryFn: async () =>
        ensureData(await fetchPublicRoadmapPosts({ data: params }), 'portalRoadmapPosts'),
      staleTime: 60 * 1000, // 1 minute
    }),
}
