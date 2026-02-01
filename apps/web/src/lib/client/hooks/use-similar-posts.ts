import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import {
  findSimilarPostsFn,
  type SimilarPost,
  type MatchStrength,
} from '@/lib/server/functions/public-posts'

/** Debounces a value, delaying updates until after a pause in changes. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

export const similarPostsKeys = {
  all: ['similarPosts'] as const,
  search: (title: string) => [...similarPostsKeys.all, title] as const,
}

interface UseSimilarPostsOptions {
  /** The title being typed by the user */
  title: string
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean
  /** Debounce delay in ms (default: 400) */
  debounceMs?: number
  /** Minimum title length to trigger search (default: 5) */
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
 * Find posts similar to the user's input title.
 * Debounces input and returns empty array when input is too short.
 */
export function useSimilarPosts({
  title,
  enabled = true,
  debounceMs = 400,
  minLength = 5,
}: UseSimilarPostsOptions): UseSimilarPostsResult {
  const debouncedTitle = useDebouncedValue(title.trim(), debounceMs)
  const shouldSearch = enabled && debouncedTitle.length >= minLength

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: similarPostsKeys.search(debouncedTitle),
    queryFn: () => findSimilarPostsFn({ data: { title: debouncedTitle, limit: 5 } }),
    enabled: shouldSearch,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  })

  return {
    posts: data ?? [],
    isLoading: shouldSearch && isLoading,
    isFetching: shouldSearch && isFetching,
    error: error as Error | null,
  }
}

// Re-export types for consumers
export type { SimilarPost, MatchStrength }
