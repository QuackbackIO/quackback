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
  const [optimisticFilters, setOptimisticFilters] = useState<PublicFeedbackFilters>(() => ({
    board: routerSearch.board,
    search: routerSearch.search,
    sort: routerSearch.sort,
    status: routerSearch.status?.length ? routerSearch.status : undefined,
    tagIds: routerSearch.tagIds?.length ? routerSearch.tagIds : undefined,
  }))

  // Track if we're in an optimistic state (local differs from router)
  const isOptimisticRef = useRef(false)

  // Sync local state with router state when navigation completes
  // This catches: browser back/forward, external navigation, initial load
  useEffect(() => {
    // Only sync if we're not in an optimistic update
    // (i.e., router caught up with our optimistic state)
    if (!isOptimisticRef.current) {
      setOptimisticFilters({
        board: routerSearch.board,
        search: routerSearch.search,
        sort: routerSearch.sort,
        status: routerSearch.status?.length ? routerSearch.status : undefined,
        tagIds: routerSearch.tagIds?.length ? routerSearch.tagIds : undefined,
      })
    } else {
      // Router state updated - check if it matches our optimistic state
      const routerMatchesOptimistic =
        routerSearch.board === optimisticFilters.board &&
        routerSearch.search === optimisticFilters.search &&
        routerSearch.sort === optimisticFilters.sort

      if (routerMatchesOptimistic) {
        // Navigation complete, no longer optimistic
        isOptimisticRef.current = false
      }
    }
  }, [routerSearch, optimisticFilters])

  const setFilters = useCallback(
    (updates: Partial<PublicFeedbackFilters>) => {
      // Update local state immediately for instant UI feedback
      const newFilters = { ...optimisticFilters, ...updates }
      setOptimisticFilters(newFilters)
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
    },
    [navigate, optimisticFilters]
  )

  const clearFilters = useCallback(() => {
    const newFilters = {
      ...optimisticFilters,
      search: undefined,
      status: undefined,
      tagIds: undefined,
    }
    setOptimisticFilters(newFilters)
    isOptimisticRef.current = true

    void navigate({
      to: '/',
      search: {
        board: newFilters.board,
        sort: newFilters.sort,
        search: undefined,
        status: undefined,
        tagIds: undefined,
      },
      replace: true,
    })
  }, [navigate, optimisticFilters])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (optimisticFilters.status?.length) count += optimisticFilters.status.length
    if (optimisticFilters.tagIds?.length) count += optimisticFilters.tagIds.length
    return count
  }, [optimisticFilters.status, optimisticFilters.tagIds])

  const hasActiveFilters = useMemo(() => {
    return !!(optimisticFilters.status?.length || optimisticFilters.tagIds?.length)
  }, [optimisticFilters.status, optimisticFilters.tagIds])

  return {
    filters: optimisticFilters,
    setFilters,
    clearFilters,
    activeFilterCount,
    hasActiveFilters,
  }
}
