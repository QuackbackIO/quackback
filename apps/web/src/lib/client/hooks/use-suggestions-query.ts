/**
 * Suggestions query hooks
 *
 * Query hooks for fetching paginated suggestion data with infinite scroll.
 */

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { fetchSuggestions } from '@/lib/server/functions/feedback'

// ============================================================================
// Types
// ============================================================================

export interface SuggestionsQueryFilters {
  status?: 'pending' | 'accepted' | 'dismissed' | 'expired'
  suggestionType?: 'create_post' | 'duplicate_post'
  sort?: 'newest' | 'relevance'
}

export interface SuggestionsPageResult {
  items: Array<Record<string, unknown>>
  total: number
  countsBySource: Record<string, number>
  nextCursor: string | null
  hasMore: boolean
}

interface UseSuggestionsQueryOptions {
  filters: SuggestionsQueryFilters
  initialData?: SuggestionsPageResult
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const suggestionsKeys = {
  all: ['suggestions'] as const,
  lists: () => [...suggestionsKeys.all, 'list'] as const,
  list: (filters: SuggestionsQueryFilters) => [...suggestionsKeys.lists(), filters] as const,
}

// ============================================================================
// Fetch Function
// ============================================================================

const PAGE_SIZE = 20

async function fetchSuggestionsPage(
  filters: SuggestionsQueryFilters,
  cursor?: string
): Promise<SuggestionsPageResult> {
  return (await fetchSuggestions({
    data: {
      status: filters.status ?? 'pending',
      suggestionType: filters.suggestionType,
      sort: filters.sort,
      offset: cursor ? parseInt(cursor) : 0,
      limit: PAGE_SIZE,
    },
  })) as unknown as SuggestionsPageResult
}

// ============================================================================
// Query Hook
// ============================================================================

export function useSuggestionsQuery({ filters, initialData }: UseSuggestionsQueryOptions) {
  return useInfiniteQuery({
    queryKey: suggestionsKeys.list(filters),
    queryFn: ({ pageParam }) => fetchSuggestionsPage(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialData: initialData
      ? {
          pages: [initialData],
          pageParams: [undefined],
        }
      : undefined,
    refetchOnMount: !initialData,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Flatten paginated suggestions into a single array */
export function flattenSuggestions(
  data: InfiniteData<SuggestionsPageResult> | undefined
): Array<Record<string, unknown>> {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}
