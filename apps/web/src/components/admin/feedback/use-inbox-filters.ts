import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/feedback'
import { useMemo, useCallback } from 'react'
import { isItemSelected, toggleItem } from './filter-utils'
import type { InboxFilters } from '@/lib/shared/types'

export type { InboxFilters }

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
      responded: search.responded,
      sort: search.sort,
    }),
    [search]
  )

  const setFilters = useCallback(
    (updates: Partial<InboxFilters>) => {
      void navigate({
        to: '/admin/feedback',
        search: {
          ...search,
          // Use 'key in updates' to check if key was explicitly passed (even if undefined)
          ...('search' in updates && { search: updates.search }),
          ...('status' in updates && { status: updates.status }),
          ...('board' in updates && { board: updates.board }),
          ...('tags' in updates && { tags: updates.tags }),
          ...('owner' in updates && { owner: updates.owner }),
          ...('dateFrom' in updates && { dateFrom: updates.dateFrom }),
          ...('dateTo' in updates && { dateTo: updates.dateTo }),
          ...('minVotes' in updates && { minVotes: updates.minVotes?.toString() }),
          ...('responded' in updates && { responded: updates.responded }),
          ...('sort' in updates && { sort: updates.sort }),
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
      filters.minVotes ||
      (filters.responded && filters.responded !== 'all')
    )
  }, [filters])

  const toggleBoard = useCallback(
    (boardId: string) => {
      const newBoard = toggleItem(filters.board, boardId)
      setFilters({ board: newBoard })
    },
    [filters.board, setFilters]
  )

  const toggleStatus = useCallback(
    (statusSlug: string) => {
      const newStatus = toggleItem(filters.status, statusSlug)
      setFilters({ status: newStatus })
    },
    [filters.status, setFilters]
  )

  const isBoardSelected = useCallback(
    (boardId: string) => isItemSelected(boardId, filters.board),
    [filters.board]
  )

  const isStatusSelected = useCallback(
    (statusSlug: string) => isItemSelected(statusSlug, filters.status),
    [filters.status]
  )

  return {
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
    toggleBoard,
    toggleStatus,
    isBoardSelected,
    isStatusSelected,
  }
}
