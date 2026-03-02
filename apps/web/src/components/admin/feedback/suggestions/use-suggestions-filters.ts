import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/feedback'
import { useMemo, useCallback } from 'react'
import { toggleItem } from '../filter-utils'
import type { SuggestionsFilters } from '@/lib/shared/types'

export type { SuggestionsFilters }

export function useSuggestionsFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: SuggestionsFilters = useMemo(
    () => ({
      search: search.suggestionSearch,
      suggestionType: search.suggestionType,
      sourceIds: search.suggestionSource?.length ? search.suggestionSource : undefined,
      sort: search.suggestionSort,
    }),
    [search]
  )

  const setFilters = useCallback(
    (updates: Partial<SuggestionsFilters>) => {
      void navigate({
        to: '/admin/feedback/suggestions',
        search: {
          ...search,
          ...('search' in updates && { suggestionSearch: updates.search }),
          ...('suggestionType' in updates && { suggestionType: updates.suggestionType }),
          ...('sourceIds' in updates && { suggestionSource: updates.sourceIds }),
          ...('sort' in updates && { suggestionSort: updates.sort }),
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const clearFilters = useCallback(() => {
    void navigate({
      to: '/admin/feedback/suggestions',
      search: {
        suggestionSort: search.suggestionSort,
      },
      replace: true,
    })
  }, [navigate, search])

  const hasActiveFilters = useMemo(() => {
    return !!(filters.search || filters.suggestionType || filters.sourceIds?.length)
  }, [filters])

  const toggleSource = useCallback(
    (sourceId: string) => {
      setFilters({ sourceIds: toggleItem(filters.sourceIds, sourceId) })
    },
    [filters.sourceIds, setFilters]
  )

  return {
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
    toggleSource,
  }
}
