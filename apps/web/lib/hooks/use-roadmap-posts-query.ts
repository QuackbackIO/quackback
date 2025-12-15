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
  list: (organizationId: string, statusSlug: string) =>
    [...roadmapPostsKeys.lists(), organizationId, statusSlug] as const,
  // New: by roadmap ID and status ID
  byRoadmap: (roadmapId: string, statusId?: string) =>
    [...roadmapPostsKeys.all, 'roadmap', roadmapId, statusId ?? 'all'] as const,
}

// ============================================================================
// Legacy Fetch Function (by status slug)
// ============================================================================

async function fetchRoadmapPosts(
  organizationId: string,
  statusSlug: string,
  page: number
): Promise<RoadmapPostListResult> {
  const params = new URLSearchParams({
    organizationId,
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
  organizationId: string
  statusSlug: string
  initialData?: RoadmapPostListResult
}

export function useRoadmapPosts({
  organizationId,
  statusSlug,
  initialData,
}: UseRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.list(organizationId, statusSlug),
    queryFn: ({ pageParam }) => fetchRoadmapPosts(organizationId, statusSlug, pageParam),
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
  organizationId: string,
  roadmapId: string,
  statusId: string | undefined,
  offset: number
): Promise<RoadmapPostsListResult> {
  const params = new URLSearchParams({
    organizationId,
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
  organizationId: string
  roadmapId: string
  statusId?: string
  enabled?: boolean
}

/**
 * Hook to fetch posts for a specific roadmap (optionally filtered by status)
 */
export function useRoadmapPostsByRoadmap({
  organizationId,
  roadmapId,
  statusId,
  enabled = true,
}: UseRoadmapPostsByRoadmapOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.byRoadmap(roadmapId, statusId),
    queryFn: ({ pageParam }) =>
      fetchRoadmapPostsByRoadmap(organizationId, roadmapId, statusId, pageParam),
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
export function useAddPostToRoadmap(organizationId: string, roadmapId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: string): Promise<void> => {
      const response = await fetch(`/api/roadmaps/${roadmapId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, organizationId }),
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
export function useRemovePostFromRoadmap(organizationId: string, roadmapId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: string): Promise<void> => {
      const response = await fetch(
        `/api/roadmaps/${roadmapId}/posts?organizationId=${organizationId}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId }),
        }
      )
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
  organizationId: string,
  roadmapId: string,
  statusId: string | undefined,
  offset: number
): Promise<RoadmapPostsListResult> {
  const params = new URLSearchParams({
    organizationId,
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
  organizationId: string
  roadmapId: string
  statusId?: string
  enabled?: boolean
}

/**
 * Hook to fetch posts for a public roadmap (no auth required)
 */
export function usePublicRoadmapPosts({
  organizationId,
  roadmapId,
  statusId,
  enabled = true,
}: UsePublicRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: [...roadmapPostsKeys.all, 'public', roadmapId, statusId ?? 'all'],
    queryFn: ({ pageParam }) =>
      fetchPublicRoadmapPosts(organizationId, roadmapId, statusId, pageParam),
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
