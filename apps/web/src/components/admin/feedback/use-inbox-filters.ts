import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/feedback'
import { useMemo, useCallback } from 'react'
import { isItemSelected, toggleItem } from '@/components/shared/filter-utils'
import type { InboxFilters } from '@/lib/shared/types'

export type { InboxFilters }

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')
    ? value
    : undefined
}

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.length === 0) return undefined
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function useInboxFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: InboxFilters = useMemo(
    () => ({
      search: search.search,
      status: stringList(search.status),
      board: stringList(search.board),
      tags: stringList(search.tags),
      segmentIds: stringList(search.segments),
      owner: search.owner,
      dateFrom: search.dateFrom,
      dateTo: search.dateTo,
      minVotes: parseOptionalInt(search.minVotes),
      minComments: parseOptionalInt(search.minComments),
      responded: search.responded,
      updatedBefore: search.updatedBefore,
      hasDuplicates: search.hasDuplicates,
      sort: search.sort,
      showDeleted: search.deleted,
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
          ...('segmentIds' in updates && { segments: updates.segmentIds }),
          ...('owner' in updates && { owner: updates.owner }),
          ...('dateFrom' in updates && { dateFrom: updates.dateFrom }),
          ...('dateTo' in updates && { dateTo: updates.dateTo }),
          ...('minVotes' in updates && { minVotes: updates.minVotes?.toString() }),
          ...('minComments' in updates && { minComments: updates.minComments?.toString() }),
          ...('responded' in updates && { responded: updates.responded }),
          ...('updatedBefore' in updates && { updatedBefore: updates.updatedBefore }),
          ...('hasDuplicates' in updates && { hasDuplicates: updates.hasDuplicates || undefined }),
          ...('sort' in updates && { sort: updates.sort }),
          ...('showDeleted' in updates && { deleted: updates.showDeleted || undefined }),
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
      filters.segmentIds?.length ||
      filters.owner ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.minVotes ||
      filters.minComments ||
      (filters.responded && filters.responded !== 'all') ||
      filters.updatedBefore ||
      filters.hasDuplicates ||
      filters.showDeleted
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

  const toggleSegment = useCallback(
    (segmentId: string) => {
      const newSegments = toggleItem(filters.segmentIds, segmentId)
      setFilters({ segmentIds: newSegments })
    },
    [filters.segmentIds, setFilters]
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
    toggleSegment,
    isBoardSelected,
    isStatusSelected,
  }
}
