import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/users'
import { useMemo, useCallback } from 'react'
import type { UsersFilters } from '@/lib/shared/types'

export type { UsersFilters }

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

    const segmentIds = (search as { segments?: string }).segments
      ? (search as { segments?: string }).segments!.split(',').filter(Boolean)
      : undefined

    return {
      search: search.search,
      verified,
      dateFrom: search.dateFrom,
      dateTo: search.dateTo,
      emailDomain: search.emailDomain,
      postCount: search.postCount,
      voteCount: search.voteCount,
      commentCount: search.commentCount,
      customAttrs: search.customAttrs,
      sort: search.sort,
      segmentIds,
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

      // Convert segmentIds array to comma-separated string for URL
      const segmentsParam =
        'segmentIds' in updates
          ? updates.segmentIds && updates.segmentIds.length > 0
            ? updates.segmentIds.join(',')
            : undefined
          : undefined

      void navigate({
        to: '/admin/users',
        search: {
          ...search,
          ...('search' in updates && { search: updates.search }),
          ...('verified' in updates && { verified: verifiedParam }),
          ...('dateFrom' in updates && { dateFrom: updates.dateFrom }),
          ...('dateTo' in updates && { dateTo: updates.dateTo }),
          ...('emailDomain' in updates && { emailDomain: updates.emailDomain }),

          ...('postCount' in updates && { postCount: updates.postCount }),
          ...('voteCount' in updates && { voteCount: updates.voteCount }),
          ...('commentCount' in updates && { commentCount: updates.commentCount }),
          ...('customAttrs' in updates && { customAttrs: updates.customAttrs }),
          ...('sort' in updates && { sort: updates.sort }),
          ...('segmentIds' in updates && { segments: segmentsParam }),
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
        // Preserve segment selection when clearing filters
        segments: (search as { segments?: string }).segments,
      },
      replace: true,
    })
  }, [navigate, search])

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.search ||
      filters.verified !== undefined ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.emailDomain ||
      filters.postCount ||
      filters.voteCount ||
      filters.commentCount ||
      filters.customAttrs
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
