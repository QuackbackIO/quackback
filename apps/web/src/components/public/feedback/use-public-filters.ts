import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/_portal/index'
import { useMemo, useCallback, useRef, useSyncExternalStore } from 'react'
import type { PublicFeedbackFilters } from '@/lib/shared/types'

export type { PublicFeedbackFilters }

let optimisticState: PublicFeedbackFilters | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return optimisticState
}

function getServerSnapshot() {
  return null
}

function setOptimistic(filters: PublicFeedbackFilters | null) {
  optimisticState = filters
  listeners.forEach((l) => l())
}

export function usePublicFilters() {
  const navigate = useNavigate()
  const routerSearch = Route.useSearch()

  const optimistic = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const lastRouterSearchRef = useRef(routerSearch)

  // Clear optimistic state when ANY tracked field changes (navigation completed)
  if (
    optimistic &&
    (lastRouterSearchRef.current.board !== routerSearch.board ||
      lastRouterSearchRef.current.sort !== routerSearch.sort ||
      lastRouterSearchRef.current.search !== routerSearch.search ||
      lastRouterSearchRef.current.minVotes !== routerSearch.minVotes ||
      lastRouterSearchRef.current.dateFrom !== routerSearch.dateFrom ||
      lastRouterSearchRef.current.responded !== routerSearch.responded ||
      lastRouterSearchRef.current.status?.join() !== routerSearch.status?.join() ||
      lastRouterSearchRef.current.tagIds?.join() !== routerSearch.tagIds?.join())
  ) {
    setOptimistic(null)
  }
  lastRouterSearchRef.current = routerSearch

  const filters: PublicFeedbackFilters = useMemo(() => {
    if (optimistic) return optimistic
    return {
      board: routerSearch.board,
      search: routerSearch.search,
      sort: routerSearch.sort,
      status: routerSearch.status?.length ? routerSearch.status : undefined,
      tagIds: routerSearch.tagIds?.length ? routerSearch.tagIds : undefined,
      minVotes: routerSearch.minVotes,
      dateFrom: routerSearch.dateFrom,
      responded: routerSearch.responded,
    }
  }, [optimistic, routerSearch])

  const setFilters = useCallback(
    (updates: Partial<PublicFeedbackFilters>) => {
      const newFilters = { ...filters, ...updates }
      setOptimistic(newFilters)

      void navigate({
        to: '/',
        search: {
          board: newFilters.board,
          search: newFilters.search,
          sort: newFilters.sort,
          status: newFilters.status,
          tagIds: newFilters.tagIds,
          minVotes: newFilters.minVotes,
          dateFrom: newFilters.dateFrom,
          responded: newFilters.responded,
        },
        replace: true,
      })
    },
    [navigate, filters]
  )

  const clearFilters = useCallback(() => {
    // Clears chip-level filters only — preserves board, sort, and search,
    // which have their own dedicated UI affordances.
    setFilters({
      status: undefined,
      tagIds: undefined,
      minVotes: undefined,
      dateFrom: undefined,
      responded: undefined,
    })
  }, [setFilters])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.status?.length) count += filters.status.length
    if (filters.tagIds?.length) count += filters.tagIds.length
    if (filters.minVotes) count += 1
    if (filters.dateFrom) count += 1
    if (filters.responded) count += 1
    return count
  }, [filters.status, filters.tagIds, filters.minVotes, filters.dateFrom, filters.responded])

  const hasActiveFilters = activeFilterCount > 0

  return {
    filters,
    setFilters,
    clearFilters,
    activeFilterCount,
    hasActiveFilters,
  }
}
