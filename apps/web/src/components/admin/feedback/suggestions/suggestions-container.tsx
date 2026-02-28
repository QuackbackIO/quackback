import { Suspense, useCallback, useMemo } from 'react'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { SuggestionsLayout } from './suggestions-layout'
import { SuggestionsFiltersSidebar } from './suggestions-filter-sidebar'
import { SuggestionList } from './suggestion-list'
import { SuggestionDetail } from './suggestion-detail'
import { useSuggestionsFilters } from './use-suggestions-filters'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import { adminQueries } from '@/lib/client/queries/admin'
import type { SuggestionListItem } from '../feedback-types'

export function SuggestionsContainer() {
  const queryClient = useQueryClient()
  const { filters, setFilters, hasActiveFilters, selectSuggestion } = useSuggestionsFilters()

  // Data queries
  const { data: sourcesData } = useSuspenseQuery(feedbackQueries.sources())
  const { data: boardsData } = useSuspenseQuery(adminQueries.boards())

  const sources = sourcesData ?? []
  const boards = boardsData ?? []

  // Fetch ALL pending suggestions (filter client-side so sidebar counts are accurate)
  const queryFilters = useMemo(
    () => ({
      status: 'pending' as const,
      suggestionType: filters.suggestionType,
      sort: filters.sort,
    }),
    [filters.suggestionType, filters.sort]
  )

  const { data } = useSuspenseQuery(feedbackQueries.suggestions(queryFilters))
  const allSuggestions = (data?.items ?? []) as SuggestionListItem[]

  // Compute suggestion counts per source for sidebar badges
  const suggestionCountsBySource = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of allSuggestions) {
      const sourceId = s.rawItem?.source?.id
      if (sourceId) {
        counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1)
      }
    }
    return counts
  }, [allSuggestions])

  // Client-side filtering for source, board, and search
  const suggestions = useMemo(() => {
    let filtered = allSuggestions

    if (filters.sourceIds?.length) {
      filtered = filtered.filter(
        (s) => s.rawItem?.source && filters.sourceIds!.includes(s.rawItem.source.id)
      )
    }

    if (filters.board?.length) {
      filtered = filtered.filter((s) => s.board && filters.board!.includes(s.board.id))
    }

    if (filters.search) {
      const q = filters.search.toLowerCase()
      filtered = filtered.filter((s) => {
        const title =
          s.suggestionType === 'merge_post'
            ? (s.rawItem?.content?.subject ?? s.signal?.summary ?? '')
            : (s.suggestedTitle ?? '')
        const body = s.rawItem?.content?.text ?? s.suggestedBody ?? ''
        const target = s.targetPost?.title ?? ''
        return (
          title.toLowerCase().includes(q) ||
          body.toLowerCase().includes(q) ||
          target.toLowerCase().includes(q)
        )
      })
    }

    // Client-side sort for confidence (server handles newest + similarity)
    if (filters.sort === 'confidence') {
      filtered = [...filtered].sort((a, b) => {
        const ac = a.signal?.extractionConfidence ?? 0
        const bc = b.signal?.extractionConfidence ?? 0
        return bc - ac
      })
    }

    return filtered
  }, [allSuggestions, filters.sourceIds, filters.board, filters.search, filters.sort])

  // Find selected suggestion
  const selectedSuggestion = useMemo(
    () => suggestions.find((s) => s.id === filters.suggestion) ?? null,
    [suggestions, filters.suggestion]
  )

  const handleSelect = useCallback(
    (suggestion: SuggestionListItem) => {
      selectSuggestion(suggestion.id)
    },
    [selectSuggestion]
  )

  const handleResolved = useCallback(() => {
    selectSuggestion(undefined)
    queryClient.invalidateQueries({ queryKey: ['feedback', 'suggestions'] })
    queryClient.invalidateQueries({ queryKey: ['feedback', 'suggestionStats'] })
  }, [selectSuggestion, queryClient])

  return (
    <SuggestionsLayout
      hasActiveFilters={hasActiveFilters}
      filters={
        <SuggestionsFiltersSidebar
          filters={filters}
          onFiltersChange={setFilters}
          sources={sources}
          boards={boards}
          suggestionCountsBySource={suggestionCountsBySource}
        />
      }
      list={
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            </div>
          }
        >
          <SuggestionList
            suggestions={suggestions}
            total={data?.total ?? 0}
            selectedId={filters.suggestion ?? null}
            onSelect={handleSelect}
            search={filters.search}
            onSearchChange={(search) => setFilters({ search: search || undefined })}
            sort={filters.sort}
            onSortChange={(sort) => setFilters({ sort })}
          />
        </Suspense>
      }
      detail={
        selectedSuggestion ? (
          <SuggestionDetail
            key={selectedSuggestion.id}
            suggestion={selectedSuggestion}
            onAccepted={handleResolved}
            onDismissed={handleResolved}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-muted/40 mb-4">
              <SparklesIcon className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground/60">Select a suggestion to review</p>
          </div>
        )
      }
    />
  )
}
