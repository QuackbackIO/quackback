'use client'

import { useQueryStates, parseAsString, parseAsStringLiteral } from 'nuqs'
import { useMemo, useCallback } from 'react'

const SORT_OPTIONS = ['top', 'new', 'trending'] as const

export interface PublicFeedbackFilters {
  board?: string
  search?: string
  sort?: 'top' | 'new' | 'trending'
}

const filterParsers = {
  board: parseAsString,
  search: parseAsString,
  sort: parseAsStringLiteral(SORT_OPTIONS),
}

export function usePublicFilters() {
  const [filterState, setFilterState] = useQueryStates(filterParsers, {
    shallow: true,
  })

  const filters: PublicFeedbackFilters = useMemo(
    () => ({
      board: filterState.board ?? undefined,
      search: filterState.search ?? undefined,
      sort: filterState.sort ?? undefined,
    }),
    [filterState]
  )

  const setFilters = useCallback(
    (updates: Partial<PublicFeedbackFilters>) => {
      const nuqsUpdates: Record<string, unknown> = {}
      if ('board' in updates) nuqsUpdates.board = updates.board ?? null
      if ('search' in updates) nuqsUpdates.search = updates.search ?? null
      if ('sort' in updates) nuqsUpdates.sort = updates.sort ?? null
      setFilterState(nuqsUpdates as Partial<typeof filterState>)
    },
    [setFilterState]
  )

  const clearFilters = useCallback(() => {
    setFilterState(null)
  }, [setFilterState])

  return { filters, setFilters, clearFilters }
}
