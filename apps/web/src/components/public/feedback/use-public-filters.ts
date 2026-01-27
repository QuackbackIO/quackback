import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/_portal/index'
import { useMemo, useCallback, useState, useEffect, useRef } from 'react'

export interface PublicFeedbackFilters {
  board?: string
  search?: string
  sort?: 'top' | 'new' | 'trending'
  status?: string[]
  tagIds?: string[]
}

function filtersFromSearch(search: {
  board?: string
  search?: string
  sort?: 'top' | 'new' | 'trending'
  status?: string[]
  tagIds?: string[]
}): PublicFeedbackFilters {
  return {
    board: search.board,
    search: search.search,
    sort: search.sort,
    status: search.status?.length ? search.status : undefined,
    tagIds: search.tagIds?.length ? search.tagIds : undefined,
  }
}

/**
 * Hook for managing public feedback filters with optimistic UI updates.
 *
 * Uses local state for instant visual feedback when filters change,
 * then syncs with router state when navigation completes.
 */
export function usePublicFilters() {
  const navigate = useNavigate()
  const routerSearch = Route.useSearch()

  // Local state for optimistic UI - updates instantly on user action
  const [optimisticFilters, setOptimisticFilters] = useState<PublicFeedbackFilters>(() =>
    filtersFromSearch(routerSearch)
  )

  // Track if we're in an optimistic state (local differs from router)
  const isOptimisticRef = useRef(false)

  // Sync local state with router state when navigation completes
  // This catches: browser back/forward, external navigation, initial load
  useEffect(() => {
    if (isOptimisticRef.current) {
      // Check if router caught up with our optimistic state
      setOptimisticFilters((current) => {
        const routerMatchesOptimistic =
          routerSearch.board === current.board &&
          routerSearch.search === current.search &&
          routerSearch.sort === current.sort

        if (routerMatchesOptimistic) {
          // Navigation complete, no longer optimistic
          isOptimisticRef.current = false
        }
        return current // Don't update state
      })
    } else {
      // Sync with router state (for browser back/forward, external navigation)
      setOptimisticFilters(filtersFromSearch(routerSearch))
    }
  }, [routerSearch])

  const setFilters = useCallback(
    (updates: Partial<PublicFeedbackFilters>) => {
      // Update local state immediately for instant UI feedback
      setOptimisticFilters((current) => {
        const newFilters = { ...current, ...updates }
        isOptimisticRef.current = true

        // Trigger navigation (happens asynchronously)
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

        return newFilters
      })
    },
    [navigate]
  )

  const clearFilters = useCallback(() => {
    setFilters({ search: undefined, status: undefined, tagIds: undefined })
  }, [setFilters])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (optimisticFilters.status?.length) count += optimisticFilters.status.length
    if (optimisticFilters.tagIds?.length) count += optimisticFilters.tagIds.length
    return count
  }, [optimisticFilters.status, optimisticFilters.tagIds])

  const hasActiveFilters = activeFilterCount > 0

  return {
    filters: optimisticFilters,
    setFilters,
    clearFilters,
    activeFilterCount,
    hasActiveFilters,
  }
}
