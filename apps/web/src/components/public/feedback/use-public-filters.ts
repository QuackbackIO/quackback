import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/_portal/index'
import { useMemo, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
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

  // Clear optimistic state when ANY tracked field changes (navigation completed).
  // This must run after render: setOptimistic notifies useSyncExternalStore
  // subscribers, and notifying them while FeedbackContainer is rendering causes
  // React's "Cannot update a component while rendering" warning.
  useEffect(() => {
    const previous = lastRouterSearchRef.current
    const changed =
      previous.board !== routerSearch.board ||
      previous.sort !== routerSearch.sort ||
      previous.search !== routerSearch.search ||
      previous.minVotes !== routerSearch.minVotes ||
      previous.dateFrom !== routerSearch.dateFrom ||
      previous.responded !== routerSearch.responded ||
      previous.owner !== routerSearch.owner ||
      previous.view !== routerSearch.view ||
      previous.status?.join() !== routerSearch.status?.join() ||
      previous.tagIds?.join() !== routerSearch.tagIds?.join() ||
      previous.segmentIds?.join() !== routerSearch.segmentIds?.join()

    if (optimistic && changed) setOptimistic(null)
    lastRouterSearchRef.current = routerSearch
  }, [optimistic, routerSearch])

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
      owner: routerSearch.owner,
      segmentIds: routerSearch.segmentIds?.length ? routerSearch.segmentIds : undefined,
      view: routerSearch.view,
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
          owner: newFilters.owner,
          segmentIds: newFilters.segmentIds,
          view: newFilters.view,
        },
        replace: true,
        resetScroll: false,
      })
    },
    [navigate, filters]
  )

  const clearFilters = useCallback(() => {
    // Clears every chip. Sort and search keep their own toolbar controls.
    setFilters({
      board: undefined,
      view: undefined,
      status: undefined,
      tagIds: undefined,
      minVotes: undefined,
      dateFrom: undefined,
      responded: undefined,
      owner: undefined,
      segmentIds: undefined,
    })
  }, [setFilters])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.board) count += 1
    if (filters.view) count += 1
    if (filters.status?.length) count += 1
    if (filters.tagIds?.length) count += filters.tagIds.length
    if (filters.minVotes) count += 1
    if (filters.dateFrom) count += 1
    if (filters.responded) count += 1
    if (filters.owner) count += 1
    if (filters.segmentIds?.length) count += filters.segmentIds.length
    return count
  }, [
    filters.board,
    filters.view,
    filters.status,
    filters.tagIds,
    filters.minVotes,
    filters.dateFrom,
    filters.responded,
    filters.owner,
    filters.segmentIds,
  ])

  const hasActiveFilters = activeFilterCount > 0

  return {
    filters,
    setFilters,
    clearFilters,
    activeFilterCount,
    hasActiveFilters,
  }
}
