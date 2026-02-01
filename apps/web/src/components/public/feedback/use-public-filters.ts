import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/_portal/index'
import { useMemo, useCallback, useRef, useSyncExternalStore } from 'react'
import type { PublicFeedbackFilters } from '@/lib/shared/types'

export type { PublicFeedbackFilters }

// Simple store for optimistic filter state that persists across renders
// but resets on navigation completion
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
  return null // Always null on server to avoid hydration mismatch
}

function setOptimistic(filters: PublicFeedbackFilters | null) {
  optimisticState = filters
  listeners.forEach((l) => l())
}

/**
 * Hook for managing public feedback filters with optimistic UI updates.
 *
 * Uses external store for optimistic state to avoid hydration mismatches.
 * Server always renders with router state, client can show optimistic updates.
 */
export function usePublicFilters() {
  const navigate = useNavigate()
  const routerSearch = Route.useSearch()

  // Use external store - returns null on server, optimistic state on client
  const optimistic = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Track the last router search to detect when navigation completes
  const lastRouterSearchRef = useRef(routerSearch)

  // Clear optimistic state when router search changes (navigation completed)
  if (
    optimistic &&
    (lastRouterSearchRef.current.board !== routerSearch.board ||
      lastRouterSearchRef.current.sort !== routerSearch.sort ||
      lastRouterSearchRef.current.search !== routerSearch.search)
  ) {
    setOptimistic(null)
  }
  lastRouterSearchRef.current = routerSearch

  // Use optimistic state if set, otherwise router state
  const filters: PublicFeedbackFilters = useMemo(() => {
    if (optimistic) return optimistic
    return {
      board: routerSearch.board,
      search: routerSearch.search,
      sort: routerSearch.sort,
      status: routerSearch.status?.length ? routerSearch.status : undefined,
      tagIds: routerSearch.tagIds?.length ? routerSearch.tagIds : undefined,
    }
  }, [optimistic, routerSearch])

  const setFilters = useCallback(
    (updates: Partial<PublicFeedbackFilters>) => {
      const newFilters = { ...filters, ...updates }

      // Set optimistic state immediately
      setOptimistic(newFilters)

      // Trigger navigation
      void navigate({
        to: '/',
        search: {
          board: newFilters.board,
          search: newFilters.search,
          sort: newFilters.sort,
          status: newFilters.status,
          tagIds: newFilters.tagIds,
        },
        replace: true,
      })
    },
    [navigate, filters]
  )

  const clearFilters = useCallback(() => {
    setFilters({ search: undefined, status: undefined, tagIds: undefined })
  }, [setFilters])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.status?.length) count += filters.status.length
    if (filters.tagIds?.length) count += filters.tagIds.length
    return count
  }, [filters.status, filters.tagIds])

  const hasActiveFilters = activeFilterCount > 0

  return {
    filters,
    setFilters,
    clearFilters,
    activeFilterCount,
    hasActiveFilters,
  }
}
