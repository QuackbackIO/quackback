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

  const filters: UsersFilters = useMemo(() => {
    let verified: boolean | undefined
    if (search.verified === 'true') {
      verified = true
    } else if (search.verified === 'false') {
      verified = false
    }

    return {
      search: search.search,
      verified,
      dateFrom: search.dateFrom,
      dateTo: search.dateTo,
      sort: search.sort,
    }
  }, [search])

  const selectedUserId = search.selected ?? null

  const setFilters = useCallback(
    (updates: Partial<UsersFilters>) => {
      // Convert boolean verified to URL param format
      let verifiedParam: 'true' | 'false' | undefined
      if ('verified' in updates) {
        if (updates.verified === true) {
          verifiedParam = 'true'
        } else if (updates.verified === false) {
          verifiedParam = 'false'
        }
      }

      void navigate({
        to: '/admin/users',
        search: {
          ...search,
          ...('search' in updates && { search: updates.search }),
          ...('verified' in updates && { verified: verifiedParam }),
          ...('dateFrom' in updates && { dateFrom: updates.dateFrom }),
          ...('dateTo' in updates && { dateTo: updates.dateTo }),
          ...('sort' in updates && { sort: updates.sort }),
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
