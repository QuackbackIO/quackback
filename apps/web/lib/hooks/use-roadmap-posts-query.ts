'use client'

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { RoadmapPost, RoadmapPostListResult } from '@quackback/domain'

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapPostsKeys = {
  all: ['roadmapPosts'] as const,
  lists: () => [...roadmapPostsKeys.all, 'list'] as const,
  list: (organizationId: string, statusSlug: string) =>
    [...roadmapPostsKeys.lists(), organizationId, statusSlug] as const,
}

// ============================================================================
// Fetch Function
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
// Query Hook
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
// Helper Functions
// ============================================================================

/**
 * Flatten paginated roadmap posts into a single array
 */
export function flattenRoadmapPosts(
  data: InfiniteData<RoadmapPostListResult> | undefined
): RoadmapPost[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}
