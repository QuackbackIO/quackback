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
      board: search.suggestionBoard?.length ? search.suggestionBoard : undefined,
      sort: search.suggestionSort,
      suggestion: search.suggestion,
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
          ...('board' in updates && { suggestionBoard: updates.board }),
          ...('sort' in updates && { suggestionSort: updates.sort }),
          ...('suggestion' in updates && { suggestion: updates.suggestion }),
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
        suggestion: search.suggestion,
      },
      replace: true,
    })
  }, [navigate, search])

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.search ||
      filters.suggestionType ||
      filters.sourceIds?.length ||
      filters.board?.length
    )
  }, [filters])

  const toggleSource = useCallback(
    (sourceId: string) => {
      setFilters({ sourceIds: toggleItem(filters.sourceIds, sourceId) })
    },
    [filters.sourceIds, setFilters]
  )

  const toggleBoard = useCallback(
    (boardId: string) => {
      setFilters({ board: toggleItem(filters.board, boardId) })
    },
    [filters.board, setFilters]
  )

  const selectSuggestion = useCallback(
    (suggestionId: string | undefined) => {
      setFilters({ suggestion: suggestionId })
    },
    [setFilters]
  )

  return {
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
    toggleSource,
    toggleBoard,
    selectSuggestion,
  }
}
