import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/users'
import { useMemo, useCallback } from 'react'

export interface UsersFilters {
  search?: string
  verified?: boolean
  dateFrom?: string
  dateTo?: string
  sort?: 'newest' | 'oldest' | 'most_active' | 'name'
}

export function useUsersFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: UsersFilters = useMemo(
    () => ({
      search: search.search,
      verified: search.verified === 'true' ? true : search.verified === 'false' ? false : undefined,
      dateFrom: search.dateFrom,
      dateTo: search.dateTo,
      sort: search.sort,
    }),
    [search]
  )

  const selectedUserId = search.selected ?? null

  const setFilters = useCallback(
    (updates: Partial<UsersFilters>) => {
      void navigate({
        to: '/admin/users',
        search: {
          ...search,
          ...(updates.search !== undefined && { search: updates.search }),
          ...(updates.verified !== undefined && {
            verified:
              updates.verified === true
                ? ('true' as const)
                : updates.verified === false
                  ? ('false' as const)
                  : undefined,
          }),
          ...(updates.dateFrom !== undefined && { dateFrom: updates.dateFrom }),
          ...(updates.dateTo !== undefined && { dateTo: updates.dateTo }),
          ...(updates.sort !== undefined && { sort: updates.sort }),
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const setSelectedUserId = useCallback(
    (userId: string | null) => {
      void navigate({
        to: '/admin/users',
        search: {
          ...search,
          selected: userId ?? undefined,
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const clearFilters = useCallback(() => {
    void navigate({
      to: '/admin/users',
      search: {
        sort: search.sort,
        selected: search.selected,
      },
      replace: true,
    })
  }, [navigate, search])

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
