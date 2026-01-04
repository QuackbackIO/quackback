import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/_portal/index'
import { useMemo, useCallback } from 'react'

export interface PublicFeedbackFilters {
  board?: string
  search?: string
  sort?: 'top' | 'new' | 'trending'
  status?: string[]
  tagIds?: string[]
}

export function usePublicFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: PublicFeedbackFilters = useMemo(
    () => ({
      board: search.board,
      search: search.search,
      sort: search.sort,
      status: search.status?.length ? search.status : undefined,
      tagIds: search.tagIds?.length ? search.tagIds : undefined,
    }),
    [search]
  )

  const setFilters = useCallback(
    (updates: Partial<PublicFeedbackFilters>) => {
      void navigate({
        to: '/',
        search: {
          ...search,
          ...updates,
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const clearFilters = useCallback(() => {
    void navigate({
      to: '/',
      search: {
        board: search.board,
        sort: search.sort,
        search: undefined,
        status: undefined,
        tagIds: undefined,
      },
      replace: true,
    })
  }, [navigate, search])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.status?.length) count += filters.status.length
    if (filters.tagIds?.length) count += filters.tagIds.length
    return count
  }, [filters.status, filters.tagIds])

  const hasActiveFilters = useMemo(() => {
    return !!(filters.status?.length || filters.tagIds?.length)
  }, [filters.status, filters.tagIds])

  return { filters, setFilters, clearFilters, activeFilterCount, hasActiveFilters }
}
