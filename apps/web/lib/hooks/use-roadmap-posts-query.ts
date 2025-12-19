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

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapPostsKeys = {
  all: ['roadmapPosts'] as const,
  lists: () => [...roadmapPostsKeys.all, 'list'] as const,
  // Legacy: by status slug (used by existing components)
  list: (workspaceId: string, statusSlug: string) =>
    [...roadmapPostsKeys.lists(), workspaceId, statusSlug] as const,
  // New: by roadmap ID and status ID
  byRoadmap: (roadmapId: string, statusId?: string) =>
    [...roadmapPostsKeys.all, 'roadmap', roadmapId, statusId ?? 'all'] as const,
}

// ============================================================================
// Legacy Fetch Function (by status slug)
// ============================================================================

async function fetchRoadmapPosts(
  workspaceId: string,
  statusSlug: string,
  page: number
): Promise<RoadmapPostListResult> {
  const params = new URLSearchParams({
    workspaceId,
    statusSlug,
    page: page.toString(),
    limit: '10',
  })

  const response = await fetch(`/api/public/roadmap/posts?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch roadmap posts')
  return response.json()
}

// ============================================================================
// Legacy Query Hook (by status slug)
// ============================================================================

interface UseRoadmapPostsOptions {
  workspaceId: string
  statusSlug: string
  initialData?: RoadmapPostListResult
}

export function useRoadmapPosts({ workspaceId, statusSlug, initialData }: UseRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.list(workspaceId, statusSlug),
    queryFn: ({ pageParam }) => fetchRoadmapPosts(workspaceId, statusSlug, pageParam),
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
// New: Fetch posts by roadmap ID
// ============================================================================

async function fetchRoadmapPostsByRoadmap(
  workspaceId: string,
  roadmapId: string,
  statusId: string | undefined,
  offset: number
): Promise<RoadmapPostsListResult> {
  const params = new URLSearchParams({
    workspaceId,
    limit: '20',
    offset: offset.toString(),
  })
  if (statusId) {
    params.append('statusId', statusId)
  }

  const response = await fetch(`/api/roadmaps/${roadmapId}/posts?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch roadmap posts')
  return response.json()
}

interface UseRoadmapPostsByRoadmapOptions {
  workspaceId: string
  roadmapId: string
  statusId?: string
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
    queryFn: ({ pageParam }) =>
      fetchRoadmapPostsByRoadmap(workspaceId, roadmapId, statusId, pageParam),
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
export function useAddPostToRoadmap(workspaceId: string, roadmapId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: string): Promise<void> => {
      const response = await fetch(`/api/roadmaps/${roadmapId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, workspaceId }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to add post to roadmap')
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
export function useRemovePostFromRoadmap(workspaceId: string, roadmapId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: string): Promise<void> => {
      const response = await fetch(`/api/roadmaps/${roadmapId}/posts?workspaceId=${workspaceId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to remove post from roadmap')
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

async function fetchPublicRoadmapPosts(
  workspaceId: string,
  roadmapId: string,
  statusId: string | undefined,
  offset: number
): Promise<RoadmapPostsListResult> {
  const params = new URLSearchParams({
    workspaceId,
    limit: '20',
    offset: offset.toString(),
  })
  if (statusId) {
    params.append('statusId', statusId)
  }

  const response = await fetch(`/api/public/roadmaps/${roadmapId}/posts?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch public roadmap posts')
  return response.json()
}

interface UsePublicRoadmapPostsOptions {
  workspaceId: string
  roadmapId: string
  statusId?: string
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
    queryFn: ({ pageParam }) =>
      fetchPublicRoadmapPosts(workspaceId, roadmapId, statusId, pageParam),
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
