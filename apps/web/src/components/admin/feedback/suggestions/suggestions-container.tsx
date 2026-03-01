import { Suspense, useCallback, useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SuggestionsLayout } from './suggestions-layout'
import { SuggestionsFiltersSidebar } from './suggestions-filter-sidebar'
import { SuggestionList } from './suggestion-list'
import { CreateFromSuggestionDialog } from './create-from-suggestion-dialog'
import { useSuggestionsFilters } from './use-suggestions-filters'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import { adminQueries } from '@/lib/client/queries/admin'
import type { SuggestionListItem } from '../feedback-types'

export function SuggestionsContainer() {
  const { filters, setFilters, hasActiveFilters } = useSuggestionsFilters()

  // Dialog state for create_post suggestions
  const [createTarget, setCreateTarget] = useState<SuggestionListItem | null>(null)

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

  const handleResolved = useCallback(() => {
    setCreateTarget(null)
  }, [])

  const handleSearchChange = useCallback(
    (search: string) => setFilters({ search: search || undefined }),
    [setFilters]
  )

  const handleSortChange = useCallback(
    (sort: 'newest' | 'similarity' | 'confidence') => setFilters({ sort }),
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
            boards={boards}
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
              total={data?.total ?? 0}
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
