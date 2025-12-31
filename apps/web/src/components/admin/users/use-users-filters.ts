import {
  useQueryState,
  useQueryStates,
  parseAsString,
  parseAsBoolean,
  parseAsStringLiteral,
} from 'nuqs'
import { useMemo, useCallback } from 'react'

const SORT_OPTIONS = ['newest', 'oldest', 'most_active', 'name'] as const

export interface UsersFilters {
  search?: string
  verified?: boolean
  dateFrom?: string
  dateTo?: string
  sort?: 'newest' | 'oldest' | 'most_active' | 'name'
}

// Define parsers for each filter
const filterParsers = {
  search: parseAsString,
  verified: parseAsBoolean,
  dateFrom: parseAsString,
  dateTo: parseAsString,
  sort: parseAsStringLiteral(SORT_OPTIONS),
}

export function useUsersFilters() {
  // Use useQueryStates for all filters at once
  // shallow: true prevents server-side re-render when URL changes
  const [filterState, setFilterState] = useQueryStates(filterParsers, {
    shallow: true,
  })

  // Separate state for selected user
  const [selectedUserId, setSelectedUserId] = useQueryState('selected', {
    shallow: true,
  })

  // Convert null values to undefined for cleaner interface
  const filters: UsersFilters = useMemo(
    () => ({
      search: filterState.search ?? undefined,
      verified: filterState.verified ?? undefined,
      dateFrom: filterState.dateFrom ?? undefined,
      dateTo: filterState.dateTo ?? undefined,
      sort: filterState.sort ?? undefined,
    }),
    [filterState]
  )

  const setFilters = useCallback(
    (updates: Partial<UsersFilters>) => {
      // Convert undefined to null for nuqs
      const nuqsUpdates: Record<string, unknown> = {}

      if ('search' in updates) nuqsUpdates.search = updates.search ?? null
      if ('verified' in updates) nuqsUpdates.verified = updates.verified ?? null
      if ('dateFrom' in updates) nuqsUpdates.dateFrom = updates.dateFrom ?? null
      if ('dateTo' in updates) nuqsUpdates.dateTo = updates.dateTo ?? null
      if ('sort' in updates) nuqsUpdates.sort = updates.sort ?? null

      setFilterState(nuqsUpdates as Partial<typeof filterState>)
    },
    [setFilterState]
  )

  const clearFilters = useCallback(() => {
    setFilterState(null)
  }, [setFilterState])

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.search ||
      filters.verified !== undefined ||
      filters.dateFrom ||
      filters.dateTo
    )
  }, [filters])

  return {
    filters,
    setFilters,
    clearFilters,
    selectedUserId,
    setSelectedUserId,
    hasActiveFilters,
  }
}
