'use client'

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type {
  RoadmapPost,
  RoadmapPostListResult,
  RoadmapPostsListResult,
  RoadmapPostEntry,
} from '@quackback/domain'
import type { WorkspaceId, RoadmapId, StatusId, PostId } from '@quackback/ids'
import {
  getRoadmapPostsAction,
  addPostToRoadmapAction,
  removePostFromRoadmapAction,
} from '@/lib/actions/roadmaps'
import {
  getPublicRoadmapPostsAction,
  getRoadmapPostsByStatusAction,
} from '@/lib/actions/public-posts'

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapPostsKeys = {
  all: ['roadmapPosts'] as const,
  lists: () => [...roadmapPostsKeys.all, 'list'] as const,
  // Legacy: by status ID (used by existing components)
  list: (workspaceId: WorkspaceId, statusId: StatusId) =>
    [...roadmapPostsKeys.lists(), workspaceId, statusId] as const,
  // New: by roadmap ID and status ID
  byRoadmap: (roadmapId: RoadmapId, statusId?: StatusId) =>
    [...roadmapPostsKeys.all, 'roadmap', roadmapId, statusId ?? 'all'] as const,
}

// ============================================================================
// Legacy Query Hook (by status ID)
// ============================================================================

interface UseRoadmapPostsOptions {
  workspaceId: WorkspaceId
  statusId: StatusId
  initialData?: RoadmapPostListResult
}

export function useRoadmapPosts({ workspaceId, statusId, initialData }: UseRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.list(workspaceId, statusId),
    queryFn: async ({ pageParam }): Promise<RoadmapPostListResult> => {
      const result = await getRoadmapPostsByStatusAction({
        workspaceId,
        statusId,
        page: pageParam,
        limit: 10,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as RoadmapPostListResult
    },
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
  workspaceId: WorkspaceId
  roadmapId: RoadmapId
  statusId?: StatusId
  enabled?: boolean
}

/**
 * Hook to fetch posts for a specific roadmap (optionally filtered by status)
 */
export function useRoadmapPostsByRoadmap({
  workspaceId,
  roadmapId,
  statusId,
  enabled = true,
}: UseRoadmapPostsByRoadmapOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.byRoadmap(roadmapId, statusId),
    queryFn: async ({ pageParam }): Promise<RoadmapPostsListResult> => {
      const result = await getRoadmapPostsAction({
        workspaceId,
        roadmapId,
        statusId,
        limit: 20,
        offset: pageParam,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as RoadmapPostsListResult
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
export function useAddPostToRoadmap(workspaceId: WorkspaceId, roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: PostId): Promise<void> => {
      const result = await addPostToRoadmapAction({
        workspaceId,
        roadmapId,
        postId,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
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
export function useRemovePostFromRoadmap(workspaceId: WorkspaceId, roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: PostId): Promise<void> => {
      const result = await removePostFromRoadmapAction({
        workspaceId,
        roadmapId,
        postId,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
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
  workspaceId: WorkspaceId
  roadmapId: RoadmapId
  statusId?: StatusId
  enabled?: boolean
}

/**
 * Hook to fetch posts for a public roadmap (no auth required)
 */
export function usePublicRoadmapPosts({
  workspaceId,
  roadmapId,
  statusId,
  enabled = true,
}: UsePublicRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: [...roadmapPostsKeys.all, 'public', roadmapId, statusId ?? 'all'],
    queryFn: async ({ pageParam }): Promise<RoadmapPostsListResult> => {
      const result = await getPublicRoadmapPostsAction({
        workspaceId,
        roadmapId,
        statusId,
        limit: 20,
        offset: pageParam,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as RoadmapPostsListResult
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
