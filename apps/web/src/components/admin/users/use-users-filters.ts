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

    const tagIds = search.tags ? search.tags.split(',').filter(Boolean) : undefined

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
      companyAttrs: search.companyAttrs,
      lifecycle: search.lifecycle,
      sort: search.sort,
      segmentIds,
      tagIds,
    }
  }, [search])

  const selectedUserId = search.selected ?? null
  const selectedCompanyId = search.company ?? null

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

      // Convert tagIds array to comma-separated string for URL
      const tagsParam =
        'tagIds' in updates
          ? updates.tagIds && updates.tagIds.length > 0
            ? updates.tagIds.join(',')
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
          ...('companyAttrs' in updates && { companyAttrs: updates.companyAttrs }),
          ...('lifecycle' in updates && {
            lifecycle:
              updates.lifecycle === 'leads' || updates.lifecycle === 'companies'
                ? updates.lifecycle
                : undefined,
          }),
          ...('sort' in updates && { sort: updates.sort }),
          ...('segmentIds' in updates && { segments: segmentsParam }),
          ...('tagIds' in updates && { tags: tagsParam }),
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

  const setSelectedCompanyId = useCallback(
    (companyId: string | null) => {
      void navigate({
        to: '/admin/users',
        search: {
          ...search,
          company: companyId ?? undefined,
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
        company: search.company,
        // Preserve segment/tag selection and the lifecycle view when clearing filters
        segments: (search as { segments?: string }).segments,
        tags: search.tags,
        lifecycle: search.lifecycle,
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
      filters.customAttrs ||
      filters.companyAttrs
    )
  }, [filters])

  return {
    filters,
    setFilters,
    clearFilters,
    selectedUserId,
    setSelectedUserId,
    selectedCompanyId,
    setSelectedCompanyId,
    hasActiveFilters,
  }
}
