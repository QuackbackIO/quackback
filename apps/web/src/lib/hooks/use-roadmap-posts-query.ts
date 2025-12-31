import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { RoadmapPost, RoadmapPostListResult } from '@/lib/posts'
import type { RoadmapPostsListResult, RoadmapPostEntry } from '@/lib/roadmaps'
import type { RoadmapId, StatusId, PostId } from '@quackback/ids'
import {
  getRoadmapPostsFn,
  addPostToRoadmapFn,
  removePostFromRoadmapFn,
} from '@/lib/server-functions/roadmaps'
import { getRoadmapPostsByStatusFn } from '@/lib/server-functions/public-posts'

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapPostsKeys = {
  all: ['roadmapPosts'] as const,
  lists: () => [...roadmapPostsKeys.all, 'list'] as const,
  // Legacy: by status ID (used by existing components)
  list: (statusId: StatusId) => [...roadmapPostsKeys.lists(), statusId] as const,
  // New: by roadmap ID and status ID
  byRoadmap: (roadmapId: RoadmapId, statusId?: StatusId) =>
    [...roadmapPostsKeys.all, 'roadmap', roadmapId, statusId ?? 'all'] as const,
}

// ============================================================================
// Legacy Query Hook (by status ID)
// ============================================================================

interface UseRoadmapPostsOptions {
  statusId: StatusId
  initialData?: RoadmapPostListResult
}

export function useRoadmapPosts({ statusId, initialData }: UseRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.list(statusId),
    queryFn: ({ pageParam }): Promise<RoadmapPostListResult> =>
      getRoadmapPostsByStatusFn({
        data: {
          statusId,
          page: pageParam,
          limit: 10,
        },
      }) as Promise<RoadmapPostListResult>,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    initialData: initialData
      ? {
          pages: [initialData],
          pageParams: [1],
        }
      : undefined,
    refetchOnMount: !initialData,
  })
}

// ============================================================================
// Admin: Fetch posts by roadmap ID
// ============================================================================

interface UseRoadmapPostsByRoadmapOptions {
  roadmapId: RoadmapId
  statusId?: StatusId
  enabled?: boolean
}

/**
 * Hook to fetch posts for a specific roadmap (optionally filtered by status)
 */
export function useRoadmapPostsByRoadmap({
  roadmapId,
  statusId,
  enabled = true,
}: UseRoadmapPostsByRoadmapOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.byRoadmap(roadmapId, statusId),
    queryFn: async ({ pageParam }): Promise<RoadmapPostsListResult> => {
      return (await getRoadmapPostsFn({
        data: {
          roadmapId,
          statusId,
          limit: 20,
          offset: pageParam,
        },
      })) as RoadmapPostsListResult
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * 20 : undefined),
    enabled,
  })
}

// ============================================================================
// Mutations for roadmap posts
// ============================================================================

/**
 * Hook to add a post to a roadmap
 */
export function useAddPostToRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: PostId): Promise<void> => {
      await addPostToRoadmapFn({
        data: {
          roadmapId,
          postId,
        },
      })
    },
    onSuccess: () => {
      // Invalidate all queries for this roadmap
      queryClient.invalidateQueries({
        queryKey: [...roadmapPostsKeys.all, 'roadmap', roadmapId],
      })
    },
  })
}

/**
 * Hook to remove a post from a roadmap
 */
export function useRemovePostFromRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: PostId): Promise<void> => {
      await removePostFromRoadmapFn({
        data: {
          roadmapId,
          postId,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...roadmapPostsKeys.all, 'roadmap', roadmapId],
      })
    },
  })
}

// ============================================================================
// Public: Fetch posts by roadmap ID (no auth required)
// ============================================================================

interface UsePublicRoadmapPostsOptions {
  roadmapId: RoadmapId
  statusId?: StatusId
  enabled?: boolean
}

/**
 * Hook to fetch posts for a public roadmap (no auth required)
 * Now aligned with portal query pattern for cache sharing with SSR
 */
export function usePublicRoadmapPosts({
  roadmapId,
  statusId,
  enabled = true,
}: UsePublicRoadmapPostsOptions) {
  return useInfiniteQuery({
    // Use portal query key pattern to match pre-fetched cache from loader
    queryKey: ['portal', 'roadmapPosts', roadmapId, statusId],
    queryFn: async ({ pageParam = 0 }): Promise<RoadmapPostsListResult> => {
      // Use server function instead of action for consistency
      const { fetchPublicRoadmapPosts } = await import('@/lib/server-functions/portal')
      return fetchPublicRoadmapPosts({
        data: {
          roadmapId,
          statusId,
          limit: 20,
          offset: pageParam,
        },
      })
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * 20 : undefined),
    enabled,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Flatten paginated roadmap posts into a single array (legacy format)
 */
export function flattenRoadmapPosts(
  data: InfiniteData<RoadmapPostListResult> | undefined
): RoadmapPost[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}

/**
 * Flatten paginated roadmap posts into a single array (new format with roadmap entry)
 */
export function flattenRoadmapPostEntries(
  data: InfiniteData<RoadmapPostsListResult> | undefined
): RoadmapPostEntry[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}
