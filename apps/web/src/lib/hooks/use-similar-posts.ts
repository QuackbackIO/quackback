import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { findSimilarPostsFn, type SimilarPost } from '@/lib/server-functions/public-posts'

// ============================================================================
// Debounce Hook
// ============================================================================

/**
 * Hook that debounces a value, delaying updates until after a pause in changes.
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const similarPostsKeys = {
  all: ['similarPosts'] as const,
  search: (title: string, boardId?: string) =>
    [...similarPostsKeys.all, title, boardId ?? 'all'] as const,
}

// ============================================================================
// Hook
// ============================================================================

interface UseSimilarPostsOptions {
  /** The title being typed by the user */
  title: string
  /** Optional board ID to filter results to same board */
  boardId?: string
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean
  /** Debounce delay in ms (default: 400) */
  debounceMs?: number
  /** Minimum title length to trigger search (default: 10) */
  minLength?: number
}

interface UseSimilarPostsResult {
  /** Similar posts found */
  posts: SimilarPost[]
  /** Whether the query is currently loading */
  isLoading: boolean
  /** Whether initial data is being fetched */
  isFetching: boolean
  /** Any error that occurred */
  error: Error | null
}

/**
 * Hook to find posts similar to the user's input title.
 * Debounces input to avoid excessive API calls.
 * Returns empty array when input is too short or disabled.
 */
export function useSimilarPosts({
  title,
  boardId,
  enabled = true,
  debounceMs = 400,
  minLength = 10,
}: UseSimilarPostsOptions): UseSimilarPostsResult {
  // Debounce the title to avoid API spam
  const debouncedTitle = useDebouncedValue(title.trim(), debounceMs)

  // Only search if we have meaningful input
  const shouldSearch = enabled && debouncedTitle.length >= minLength

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: similarPostsKeys.search(debouncedTitle, boardId),
    queryFn: () =>
      findSimilarPostsFn({
        data: {
          title: debouncedTitle,
          boardId,
          limit: 5,
        },
      }),
    enabled: shouldSearch,
    staleTime: 60_000, // Cache for 1 minute
    gcTime: 5 * 60_000, // Keep in cache 5 minutes
    // Don't retry on failure - this is non-critical
    retry: false,
  })

  return {
    posts: data ?? [],
    isLoading: shouldSearch && isLoading,
    isFetching: shouldSearch && isFetching,
    error: error as Error | null,
  }
}

// Re-export type for consumers
export type { SimilarPost }
