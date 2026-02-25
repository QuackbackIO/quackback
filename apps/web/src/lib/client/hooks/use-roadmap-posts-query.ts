import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { RoadmapPost, RoadmapPostListResult } from '@/lib/server/domains/posts'
import type { RoadmapPostsListResult, RoadmapPostEntry } from '@/lib/server/domains/roadmaps'
import type { RoadmapId, StatusId } from '@quackback/ids'
import type { RoadmapFilters } from '@/lib/shared/types'
import { getRoadmapPostsFn } from '@/lib/server/functions/roadmaps'
import { getRoadmapPostsByStatusFn } from '@/lib/server/functions/public-posts'

// ============================================================================
// Types
// ============================================================================

interface UseRoadmapPostsOptions {
  statusId: StatusId
  initialData?: RoadmapPostListResult
}

interface UseRoadmapPostsByRoadmapOptions {
  roadmapId: RoadmapId
  statusId?: StatusId
  filters?: RoadmapFilters
  enabled?: boolean
}

interface UsePublicRoadmapPostsOptions {
  roadmapId: RoadmapId
  statusId?: StatusId
  filters?: RoadmapFilters
  enabled?: boolean
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapPostsKeys = {
  all: ['roadmapPosts'] as const,
  lists: () => [...roadmapPostsKeys.all, 'list'] as const,
  list: (statusId: StatusId) => [...roadmapPostsKeys.lists(), statusId] as const,
  byRoadmap: (roadmapId: RoadmapId, statusId?: StatusId, filters?: RoadmapFilters) =>
    [...roadmapPostsKeys.all, 'roadmap', roadmapId, statusId ?? 'all', filters ?? {}] as const,
  portal: (roadmapId: RoadmapId, statusId?: StatusId, filters?: RoadmapFilters) =>
    ['portal', 'roadmapPosts', roadmapId, statusId, filters ?? {}] as const,
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
    initialData: initialData ? { pages: [initialData], pageParams: [1] } : undefined,
    refetchOnMount: !initialData,
  })
}

export function useRoadmapPostsByRoadmap({
  roadmapId,
  statusId,
  filters,
  enabled = true,
}: UseRoadmapPostsByRoadmapOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.byRoadmap(roadmapId, statusId, filters),
    queryFn: ({ pageParam }) =>
      getRoadmapPostsFn({
        data: {
          roadmapId,
          statusId,
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
    enabled,
  })
}

export function usePublicRoadmapPosts({
  roadmapId,
  statusId,
  filters,
  enabled = true,
}: UsePublicRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.portal(roadmapId, statusId, filters),
    queryFn: async ({ pageParam = 0 }) => {
      const { fetchPublicRoadmapPosts } = await import('@/lib/server/functions/portal')
      return fetchPublicRoadmapPosts({
        data: {
          roadmapId,
          statusId,
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

/** Flatten paginated roadmap post entries into a single array */
export function flattenRoadmapPostEntries(
  data: InfiniteData<RoadmapPostsListResult> | undefined
): RoadmapPostEntry[] {
  if (!data?.pages) return []
  return data.pages.flatMap((page) => page?.items ?? []).filter((item) => item?.id)
}
