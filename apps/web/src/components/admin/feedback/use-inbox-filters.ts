import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/feedback'
import { useMemo, useCallback } from 'react'

export interface InboxFilters {
  search?: string
  /** Status slugs for filtering (e.g., 'open', 'planned') */
  status?: string[]
  board?: string[]
  tags?: string[]
  owner?: string | 'unassigned'
  dateFrom?: string
  dateTo?: string
  minVotes?: number
  sort?: 'newest' | 'oldest' | 'votes'
}

export function useInboxFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: InboxFilters = useMemo(
    () => ({
      search: search.search,
      status: search.status?.length ? search.status : undefined,
      board: search.board?.length ? search.board : undefined,
      tags: search.tags?.length ? search.tags : undefined,
      owner: search.owner,
      dateFrom: search.dateFrom,
      dateTo: search.dateTo,
      minVotes: search.minVotes ? parseInt(search.minVotes, 10) : undefined,
      sort: search.sort,
    }),
    [search]
  )

  const selectedPostId = search.selected ?? null

  const setFilters = useCallback(
    (updates: Partial<InboxFilters>) => {
      void navigate({
        to: '/admin/feedback',
        search: {
          ...search,
          ...(updates.search !== undefined && { search: updates.search }),
          ...(updates.status !== undefined && { status: updates.status }),
          ...(updates.board !== undefined && { board: updates.board }),
          ...(updates.tags !== undefined && { tags: updates.tags }),
          ...(updates.owner !== undefined && { owner: updates.owner }),
          ...(updates.dateFrom !== undefined && { dateFrom: updates.dateFrom }),
          ...(updates.dateTo !== undefined && { dateTo: updates.dateTo }),
          ...(updates.minVotes !== undefined && { minVotes: updates.minVotes?.toString() }),
          ...(updates.sort !== undefined && { sort: updates.sort }),
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const setSelectedPostId = useCallback(
    (postId: string | null) => {
      void navigate({
        to: '/admin/feedback',
        search: {
          ...search,
          selected: postId ?? undefined,
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const clearFilters = useCallback(() => {
    void navigate({
      to: '/admin/feedback',
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
      filters.status?.length ||
      filters.board?.length ||
      filters.tags?.length ||
      filters.owner ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.minVotes
    )
  }, [filters])

  return {
    filters,
    setFilters,
    clearFilters,
    selectedPostId,
    setSelectedPostId,
    hasActiveFilters,
  }
}
