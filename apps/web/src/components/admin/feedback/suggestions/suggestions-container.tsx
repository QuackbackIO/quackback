import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SuggestionsLayout } from './suggestions-layout'
import { SuggestionsFiltersSidebar } from './suggestions-filter-sidebar'
import { SuggestionList } from './suggestion-list'
import { CreateFromSuggestionDialog } from './create-from-suggestion-dialog'
import { useSuggestionsFilters } from './use-suggestions-filters'
import {
  useSuggestionsQuery,
  flattenSuggestions,
  type SuggestionsPageResult,
} from '@/lib/client/hooks/use-suggestions-query'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import type { SuggestionListItem, FeedbackSourceView } from '../feedback-types'

interface SuggestionsContainerProps {
  initialSuggestions?: SuggestionsPageResult
}

export function SuggestionsContainer({ initialSuggestions }: SuggestionsContainerProps) {
  const { filters, setFilters, hasActiveFilters } = useSuggestionsFilters()

  // Dialog state for create_post suggestions
  const [createTarget, setCreateTarget] = useState<SuggestionListItem | null>(null)

  // Data queries
  const { data: sourcesData } = useSuspenseQuery(feedbackQueries.sources())

  const sources: FeedbackSourceView[] = sourcesData ?? []

  // Track whether we're on the initial render (for using server-prefetched data)
  const isInitialRender = useRef(true)
  useEffect(() => {
    isInitialRender.current = false
  }, [])

  const shouldUseInitialData =
    isInitialRender.current && !filters.search && !filters.sourceIds?.length

  // Server-side query filters — always create_post only
  const queryFilters = useMemo(
    () => ({
      status: 'pending' as const,
      suggestionType: 'create_post' as const,
      sort: filters.sort,
    }),
    [filters.sort]
  )

  // Infinite query for paginated suggestions
  const {
    data: paginatedData,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
  } = useSuggestionsQuery({
    filters: queryFilters,
    initialData: shouldUseInitialData ? initialSuggestions : undefined,
  })

  const allSuggestions = flattenSuggestions(paginatedData) as unknown as SuggestionListItem[]

  // Use server-provided per-source counts from the first page (reflects totals, not just current page)
  const countsBySourceJson = JSON.stringify(paginatedData?.pages[0]?.countsBySource)
  const suggestionCountsBySource = useMemo(() => {
    const counts = new Map<string, number>()
    const parsed = JSON.parse(countsBySourceJson ?? 'null') as Record<string, number> | null
    if (parsed) {
      for (const [sourceId, cnt] of Object.entries(parsed)) {
        counts.set(sourceId, cnt)
      }
    }
    return counts
  }, [countsBySourceJson])

  // Client-side filtering for source and search
  const suggestions = useMemo(() => {
    let filtered = allSuggestions

    if (filters.sourceIds?.length) {
      filtered = filtered.filter(
        (s) => s.rawItem?.source && filters.sourceIds!.includes(s.rawItem.source.id)
      )
    }

    if (filters.search) {
      const q = filters.search.toLowerCase()
      filtered = filtered.filter((s) => {
        const title = s.suggestedTitle ?? ''
        const body = s.rawItem?.content?.text ?? s.suggestedBody ?? ''
        return title.toLowerCase().includes(q) || body.toLowerCase().includes(q)
      })
    }

    return filtered
  }, [allSuggestions, filters.sourceIds, filters.search])

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) {
      fetchNextPage()
    }
  }, [hasMore, isLoadingMore, fetchNextPage])

  const handleResolved = useCallback(() => {
    setCreateTarget(null)
  }, [])

  const handleSearchChange = useCallback(
    (search: string) => setFilters({ search: search || undefined }),
    [setFilters]
  )

  const handleSortChange = useCallback(
    (sort: 'newest' | 'relevance') => setFilters({ sort }),
    [setFilters]
  )

  return (
    <>
      <SuggestionsLayout
        hasActiveFilters={hasActiveFilters}
        filters={
          <SuggestionsFiltersSidebar
            filters={filters}
            onFiltersChange={setFilters}
            sources={sources}
            suggestionCountsBySource={suggestionCountsBySource}
          />
        }
        content={
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-16">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              </div>
            }
          >
            <SuggestionList
              suggestions={suggestions}
              hasMore={!!hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={handleLoadMore}
              onCreatePost={setCreateTarget}
              onResolved={handleResolved}
              search={filters.search}
              onSearchChange={handleSearchChange}
              sort={filters.sort}
              onSortChange={handleSortChange}
            />
          </Suspense>
        }
      />

      <CreateFromSuggestionDialog
        suggestion={createTarget}
        onOpenChange={(open) => {
          if (!open) setCreateTarget(null)
        }}
        onCreated={handleResolved}
      />
    </>
  )
}
