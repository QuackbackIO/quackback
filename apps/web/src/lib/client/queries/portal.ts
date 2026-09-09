import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type { PrincipalId, RoadmapId, PostStatusId, BoardId } from '@quackback/ids'
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

/**
 * Query families whose payload depends on who the viewer is: the tag catalog
 * hides internal tags from non-team viewers; portal data, the infinite feed
 * (`publicPostsKeys`, see use-portal-posts-query), post lists and post detail
 * embed that filtered catalog; public roadmap results honour the same guard
 * for caller-supplied tag filters; and the roadmap catalog's `baseFilter` has
 * internal tag ids redacted for non-team viewers.
 */
export const VIEWER_SCOPED_PORTAL_QUERY_KEYS: readonly (readonly string[])[] = [
  ['portal', 'tags'],
  ['portal', 'data'],
  ['portal', 'posts'],
  ['portal', 'post'],
  ['portal', 'roadmaps'],
  ['portal', 'roadmapPosts'],
  ['publicPosts'],
]

/**
 * Remove every viewer-scoped portal cache entry on an auth transition, so a
 * team member signing out does not keep seeing internal tags and a team member
 * signing in gains them.
 *
 * This must *remove*, not invalidate or reset: `invalidateQueries` keeps the
 * data and route loaders read it back through `ensureQueryData` without
 * waiting for a refetch; `resetQueries` restores a query's `initialData`, and
 * the feed (`usePublicPosts`) seeds its pages from the SSR payload that way, so
 * a reset would put the team-scoped page straight back. `removeQueries` drops
 * the entries outright. Callers follow up with `router.invalidate()`, which
 * re-runs loaders and re-renders observers so they rebuild against fresh
 * queries as the new viewer.
 *
 * Call from every portal sign-out control and sign-in success handler.
 */
export function removeViewerScopedPortalQueries(queryClient: QueryClient): void {
  for (const queryKey of VIEWER_SCOPED_PORTAL_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey })
  }
}

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
    owner?: string
    segmentIds?: string[]
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
        params.owner,
        params.segmentIds,
      ],
      queryFn: async () => {
        const data = await fetchPortalData({ data: params })
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
      queryFn: () => fetchPublicBoards(),
    }),

  /**
   * List posts for a board with filtering
   */
  posts: (filters: { boardSlug?: string; search?: string; sort: 'top' | 'new' | 'trending' }) =>
    queryOptions({
      queryKey: ['portal', 'posts', filters],
      queryFn: () => fetchPublicPosts({ data: filters }),
    }),

  /**
   * List all public statuses
   */
  statuses: () =>
    queryOptions({
      queryKey: ['portal', 'statuses'],
      queryFn: () => fetchPublicStatuses(),
    }),

  /**
   * List all public tags
   */
  tags: () =>
    queryOptions({
      queryKey: ['portal', 'tags'],
      queryFn: () => fetchPublicTags(),
    }),

  /**
   * Get bulk avatar data for post authors
   */
  avatars: (principalIds: PrincipalId[]) =>
    queryOptions({
      queryKey: ['portal', 'avatars', principalIds],
      queryFn: () => fetchAvatars({ data: principalIds }),
      // Avatars don't change often
      staleTime: 5 * 60 * 1000, // 5 minutes
    }),

  /**
   * List all public roadmaps
   */
  roadmaps: () =>
    queryOptions({
      queryKey: ['portal', 'roadmaps'],
      queryFn: () => fetchPublicRoadmaps(),
      // Roadmaps don't change often
      staleTime: 2 * 60 * 1000, // 2 minutes
    }),

  /**
   * List posts for a roadmap column (roadmap + status combination)
   */
  roadmapPosts: (params: {
    roadmapId: RoadmapId
    statusId: PostStatusId
    limit?: number
    offset?: number
  }) =>
    queryOptions({
      // Don't include offset/limit in query key to allow cache sharing with infinite queries
      queryKey: ['portal', 'roadmapPosts', params.roadmapId, params.statusId],
      queryFn: () => fetchPublicRoadmapPosts({ data: params }),
      staleTime: 60 * 1000, // 1 minute
    }),
}
