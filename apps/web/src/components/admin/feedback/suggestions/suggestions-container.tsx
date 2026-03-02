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

  // Server-side query filters (type + sort go to server, source/board/search are client-side)
  const queryFilters = useMemo(
    () => ({
      status: 'pending' as const,
      suggestionType: filters.suggestionType,
      sort: filters.sort,
    }),
    [filters.suggestionType, filters.sort]
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
  const suggestionCountsBySource = useMemo(() => {
    const counts = new Map<string, number>()
    const firstPage = paginatedData?.pages[0]
    if (firstPage?.countsBySource) {
      for (const [sourceId, cnt] of Object.entries(firstPage.countsBySource)) {
        counts.set(sourceId, cnt as number)
      }
    }
    return counts
  }, [paginatedData?.pages[0]?.countsBySource])

  // Client-side filtering for source, board, and search
  const suggestions = useMemo(() => {
    let filtered = allSuggestions

    if (filters.sourceIds?.length) {
      // Find if quackback source is among selected sources
      const quackbackSource = sources.find((s) => s.sourceType === 'quackback')
      const includesQuackback = !!quackbackSource && filters.sourceIds.includes(quackbackSource.id)

      filtered = filtered.filter((s) => {
        // Merge suggestions belong to quackback source
        if (s.suggestionType === 'duplicate_post') return includesQuackback
        return s.rawItem?.source && filters.sourceIds!.includes(s.rawItem.source.id)
      })
    }

    if (filters.search) {
      const q = filters.search.toLowerCase()
      filtered = filtered.filter((s) => {
        const title =
          s.suggestionType === 'duplicate_post'
            ? (s.sourcePost?.title ?? '')
            : (s.suggestedTitle ?? '')
        const body =
          s.suggestionType === 'duplicate_post'
            ? (s.sourcePost?.content ?? s.targetPost?.content ?? '')
            : (s.rawItem?.content?.text ?? s.suggestedBody ?? '')
        const target = s.targetPost?.title ?? ''
        return (
          title.toLowerCase().includes(q) ||
          body.toLowerCase().includes(q) ||
          target.toLowerCase().includes(q)
        )
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
