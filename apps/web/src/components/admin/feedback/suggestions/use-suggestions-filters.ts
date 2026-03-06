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
      sourceTypes: search.source ? [search.source] : undefined,
      sort: search.suggestionSort,
    }),
    [search]
  )

  const setFilters = useCallback(
    (updates: Partial<SuggestionsFilters>) => {
      void navigate({
        to: '/admin/feedback/incoming',
        search: {
          ...search,
          ...('search' in updates && { suggestionSearch: updates.search }),
          ...('sourceTypes' in updates && {
            source: updates.sourceTypes?.[0],
          }),
          ...('sort' in updates && { suggestionSort: updates.sort }),
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const clearFilters = useCallback(() => {
    void navigate({
      to: '/admin/feedback/incoming',
      search: {
        suggestionSort: search.suggestionSort,
      },
      replace: true,
    })
  }, [navigate, search])

  const hasActiveFilters = useMemo(() => {
    return !!(filters.search || filters.sourceTypes?.length)
  }, [filters])

  const toggleSource = useCallback(
    (sourceId: string) => {
      setFilters({ sourceTypes: toggleItem(filters.sourceTypes, sourceId) })
    },
    [filters.sourceTypes, setFilters]
  )

  return {
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
    toggleSource,
  }
}
