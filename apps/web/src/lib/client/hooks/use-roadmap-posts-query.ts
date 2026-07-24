import { useInfiniteQuery, keepPreviousData, type InfiniteData } from '@tanstack/react-query'
import type {
  RoadmapPost,
  RoadmapPostListResult,
  RoadmapPostsListResult,
  RoadmapViewPost,
} from '@/lib/shared/types'
import type { RoadmapId, PostStatusId } from '@quackback/ids'
import type { RoadmapFilters } from '@/lib/shared/types'
import { getRoadmapPostsFn } from '@/lib/server/functions/roadmaps'
import { getRoadmapPostsByStatusFn } from '@/lib/server/functions/public-posts'

// ============================================================================
// Types
// ============================================================================

interface UseRoadmapPostsOptions {
  statusId: PostStatusId
  initialData?: RoadmapPostListResult
}

interface UseRoadmapPostsByRoadmapOptions {
  roadmapId: RoadmapId
  statusId?: PostStatusId
  bucketId?: string
  filters?: RoadmapFilters
  enabled?: boolean
}

interface UsePublicRoadmapPostsOptions {
  roadmapId: RoadmapId
  statusId?: PostStatusId
  bucketId?: string
  filters?: RoadmapFilters
  enabled?: boolean
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapPostsKeys = {
  all: ['roadmapPosts'] as const,
  lists: () => [...roadmapPostsKeys.all, 'list'] as const,
  list: (statusId: PostStatusId) => [...roadmapPostsKeys.lists(), statusId] as const,
  byRoadmap: (
    roadmapId: RoadmapId,
    statusId?: PostStatusId,
    bucketId?: string,
    filters?: RoadmapFilters
  ) =>
    [
      ...roadmapPostsKeys.all,
      'roadmap',
      roadmapId,
      statusId ?? bucketId ?? 'all',
      filters ?? {},
    ] as const,
  portal: (
    roadmapId: RoadmapId,
    statusId?: PostStatusId,
    bucketId?: string,
    filters?: RoadmapFilters
  ) => ['portal', 'roadmapPosts', roadmapId, statusId ?? bucketId, filters ?? {}] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

export function useRoadmapPosts({ statusId, initialData }: UseRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.list(statusId),
    queryFn: ({ pageParam }) =>
      getRoadmapPostsByStatusFn({
        data: { statusId, page: pageParam, limit: 10 },
      }) as Promise<RoadmapPostListResult>,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    // Page number inverts trivially (page - 1); no live consumer currently
    // imports this hook (admin-tier cap applied for when one does).
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 1 ? firstPageParam - 1 : undefined,
    maxPages: 5,
    initialData: initialData ? { pages: [initialData], pageParams: [1] } : undefined,
    refetchOnMount: !initialData,
    placeholderData: keepPreviousData,
  })
}

export function useRoadmapPostsByRoadmap({
  roadmapId,
  statusId,
  bucketId,
  filters,
  enabled = true,
}: UseRoadmapPostsByRoadmapOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.byRoadmap(roadmapId, statusId, bucketId, filters),
    queryFn: ({ pageParam }) =>
      getRoadmapPostsFn({
        data: {
          roadmapId,
          statusId,
          bucketId,
          limit: 20,
          offset: pageParam,
          search: filters?.search,
          boardIds: filters?.board,
          tagIds: filters?.tags,
          segmentIds: filters?.segmentIds,
          sort: filters?.sort,
        },
      }) as Promise<RoadmapPostsListResult>,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * 20 : undefined),
    // Offset inverts trivially (offset - 20, floored at 0) — admin board.
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 0 ? Math.max(0, firstPageParam - 20) : undefined,
    maxPages: 5,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function usePublicRoadmapPosts({
  roadmapId,
  statusId,
  bucketId,
  filters,
  enabled = true,
}: UsePublicRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.portal(roadmapId, statusId, bucketId, filters),
    queryFn: async ({ pageParam = 0 }) => {
      const { fetchPublicRoadmapPosts } = await import('@/lib/server/functions/portal')
      return fetchPublicRoadmapPosts({
        data: {
          roadmapId,
          statusId,
          bucketId,
          limit: 20,
          offset: pageParam,
          search: filters?.search,
          boardIds: filters?.board,
          tagIds: filters?.tags,
          segmentIds: filters?.segmentIds,
          sort: filters?.sort,
        },
      }) as Promise<RoadmapPostsListResult>
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * 20 : undefined),
    // Offset inverts trivially (offset - 20, floored at 0) — visitor-facing
    // roadmap board, so the wider scroll-back cap.
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 0 ? Math.max(0, firstPageParam - 20) : undefined,
    maxPages: 8,
    placeholderData: keepPreviousData,
    enabled,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Flatten paginated roadmap posts into a single array */
export function flattenRoadmapPosts(
  data: InfiniteData<RoadmapPostListResult> | undefined
): RoadmapPost[] {
  if (!data?.pages) return []
  return data.pages.flatMap((page) => page?.items ?? []).filter((item) => item?.id)
}

/** Flatten paginated posts returned by a derived roadmap view. */
export function flattenRoadmapViewPosts(
  data: InfiniteData<RoadmapPostsListResult> | undefined
): RoadmapViewPost[] {
  if (!data?.pages) return []
  return data.pages.flatMap((page) => page?.items ?? []).filter((item) => item?.id)
}
