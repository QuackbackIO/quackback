'use client'

import { useQueryStates, parseAsString, parseAsStringLiteral, parseAsArrayOf } from 'nuqs'
import { useMemo, useCallback } from 'react'

const SORT_OPTIONS = ['top', 'new', 'trending'] as const

export interface PublicFeedbackFilters {
  board?: string
  search?: string
  sort?: 'top' | 'new' | 'trending'
  status?: string[]
  tagIds?: string[]
}

const filterParsers = {
  board: parseAsString,
  search: parseAsString,
  sort: parseAsStringLiteral(SORT_OPTIONS),
  status: parseAsArrayOf(parseAsString),
  tagIds: parseAsArrayOf(parseAsString),
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
      status: filterState.status?.length ? filterState.status : undefined,
      tagIds: filterState.tagIds?.length ? filterState.tagIds : undefined,
    }),
    [filterState]
  )

  const setFilters = useCallback(
    (updates: Partial<PublicFeedbackFilters>) => {
      const nuqsUpdates: Record<string, unknown> = {}
      if ('board' in updates) nuqsUpdates.board = updates.board ?? null
      if ('search' in updates) nuqsUpdates.search = updates.search ?? null
      if ('sort' in updates) nuqsUpdates.sort = updates.sort ?? null
      if ('status' in updates) nuqsUpdates.status = updates.status ?? null
      if ('tagIds' in updates) nuqsUpdates.tagIds = updates.tagIds ?? null
      setFilterState(nuqsUpdates as Partial<typeof filterState>)
    },
    [setFilterState]
  )

  const clearFilters = useCallback(() => {
    setFilterState(null)
  }, [setFilterState])

  // Compute active filter count (excluding sort and board which have their own UI)
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.status?.length) count += filters.status.length
    if (filters.tagIds?.length) count += filters.tagIds.length
    return count
  }, [filters.status, filters.tagIds])

  // Check if any dropdown filters are active
  const hasActiveFilters = useMemo(() => {
    return !!(filters.status?.length || filters.tagIds?.length)
  }, [filters.status, filters.tagIds])

  return { filters, setFilters, clearFilters, activeFilterCount, hasActiveFilters }
}
