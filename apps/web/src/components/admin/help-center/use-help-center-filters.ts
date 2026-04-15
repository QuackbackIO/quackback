import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/help-center'
import { useMemo, useCallback } from 'react'

export type HelpCenterStatusFilter = 'all' | 'draft' | 'published'

export interface HelpCenterFilters {
  status: HelpCenterStatusFilter
  category?: string
  search?: string
  sort: 'newest' | 'oldest'
  showDeleted?: boolean
}

export function useHelpCenterFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: HelpCenterFilters = useMemo(
    () => ({
      status: search.status ?? 'all',
      category: search.category,
      search: search.search,
      sort: search.sort ?? 'newest',
      showDeleted: search.deleted,
    }),
    [search.status, search.category, search.search, search.sort, search.deleted]
  )

  const setFilters = useCallback(
    (updates: Partial<HelpCenterFilters>) => {
      void navigate({
        to: '/admin/help-center',
        search: {
          ...search,
          ...('status' in updates && {
            status: updates.status === 'all' ? undefined : updates.status,
          }),
          ...('category' in updates && {
            category: updates.category || undefined,
          }),
          ...('search' in updates && {
            search: updates.search || undefined,
          }),
          ...('sort' in updates && {
            sort: updates.sort === 'newest' ? undefined : updates.sort,
          }),
          ...('showDeleted' in updates && {
            deleted: updates.showDeleted || undefined,
          }),
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const clearFilters = useCallback(() => {
    void navigate({
      to: '/admin/help-center',
      search: {},
      replace: true,
    })
  }, [navigate])

  const hasActiveFilters = useMemo(() => {
    return (
      filters.status !== 'all' || !!filters.search || !!filters.showDeleted || !!filters.category
    )
  }, [filters.status, filters.search, filters.showDeleted, filters.category])

  return {
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
  }
}
