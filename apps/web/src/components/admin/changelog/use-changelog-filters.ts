import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/changelog'
import { useMemo, useCallback } from 'react'

export type ChangelogStatusFilter = 'all' | 'draft' | 'scheduled' | 'published'

export interface ChangelogFilters {
  status: ChangelogStatusFilter
}

export function useChangelogFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: ChangelogFilters = useMemo(
    () => ({
      status: search.status ?? 'all',
    }),
    [search.status]
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
