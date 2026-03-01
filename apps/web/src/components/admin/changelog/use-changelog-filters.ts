import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/changelog'
import { useMemo, useCallback } from 'react'

export type ChangelogStatusFilter = 'all' | 'draft' | 'scheduled' | 'published'

export interface ChangelogFilters {
  status: ChangelogStatusFilter
  search?: string
}

export function useChangelogFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: ChangelogFilters = useMemo(
    () => ({
      status: search.status ?? 'all',
      search: search.search,
    }),
    [search.status, search.search]
  )

  const setFilters = useCallback(
    (updates: Partial<ChangelogFilters>) => {
      void navigate({
        to: '/admin/changelog',
        search: {
          ...search,
          ...('status' in updates && {
            status: updates.status === 'all' ? undefined : updates.status,
          }),
          ...('search' in updates && {
            search: updates.search || undefined,
          }),
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const clearFilters = useCallback(() => {
    void navigate({
      to: '/admin/changelog',
      search: {},
      replace: true,
    })
  }, [navigate])

  const hasActiveFilters = useMemo(() => {
    return filters.status !== 'all'
  }, [filters.status])

  return {
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
  }
}
