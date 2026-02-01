import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { RoadmapPost, RoadmapPostListResult } from '@/lib/posts'
import type { RoadmapPostsListResult, RoadmapPostEntry } from '@/lib/roadmaps'
import type { RoadmapId, StatusId } from '@quackback/ids'
import { getRoadmapPostsFn } from '@/lib/server-functions/roadmaps'
import { getRoadmapPostsByStatusFn } from '@/lib/server-functions/public-posts'

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
  enabled?: boolean
}

interface UsePublicRoadmapPostsOptions {
  roadmapId: RoadmapId
  statusId?: StatusId
  enabled?: boolean
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapPostsKeys = {
  all: ['roadmapPosts'] as const,
  lists: () => [...roadmapPostsKeys.all, 'list'] as const,
  list: (statusId: StatusId) => [...roadmapPostsKeys.lists(), statusId] as const,
  byRoadmap: (roadmapId: RoadmapId, statusId?: StatusId) =>
    [...roadmapPostsKeys.all, 'roadmap', roadmapId, statusId ?? 'all'] as const,
  portal: (roadmapId: RoadmapId, statusId?: StatusId) =>
    ['portal', 'roadmapPosts', roadmapId, statusId] as const,
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
  enabled = true,
}: UseRoadmapPostsByRoadmapOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.byRoadmap(roadmapId, statusId),
    queryFn: ({ pageParam }) =>
      getRoadmapPostsFn({
        data: { roadmapId, statusId, limit: 20, offset: pageParam },
      }) as Promise<RoadmapPostsListResult>,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * 20 : undefined),
    enabled,
  })
}

export function usePublicRoadmapPosts({
  roadmapId,
  statusId,
  enabled = true,
}: UsePublicRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.portal(roadmapId, statusId),
    queryFn: async ({ pageParam = 0 }) => {
      const { fetchPublicRoadmapPosts } = await import('@/lib/server-functions/portal')
      return fetchPublicRoadmapPosts({
        data: { roadmapId, statusId, limit: 20, offset: pageParam },
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
