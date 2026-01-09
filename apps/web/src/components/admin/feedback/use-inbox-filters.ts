import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/feedback'
import { useMemo, useCallback } from 'react'
import { isItemSelected, toggleItem } from './filter-utils'

export interface InboxFilters {
  search?: string
  /** Status slugs for filtering (e.g., 'open', 'planned') */
  status?: string[]
  /** Status slugs to exclude (inverse of status) */
  excludeStatus?: string[]
  board?: string[]
  /** Board IDs to exclude (inverse of board) */
  excludeBoard?: string[]
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
      excludeStatus: search.excludeStatus?.length ? search.excludeStatus : undefined,
      board: search.board?.length ? search.board : undefined,
      excludeBoard: search.excludeBoard?.length ? search.excludeBoard : undefined,
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
          // Use 'key in updates' to check if key was explicitly passed (even if undefined)
          ...('search' in updates && { search: updates.search }),
          ...('status' in updates && { status: updates.status }),
          ...('excludeStatus' in updates && { excludeStatus: updates.excludeStatus }),
          ...('board' in updates && { board: updates.board }),
          ...('excludeBoard' in updates && { excludeBoard: updates.excludeBoard }),
          ...('tags' in updates && { tags: updates.tags }),
          ...('owner' in updates && { owner: updates.owner }),
          ...('dateFrom' in updates && { dateFrom: updates.dateFrom }),
          ...('dateTo' in updates && { dateTo: updates.dateTo }),
          ...('minVotes' in updates && { minVotes: updates.minVotes?.toString() }),
          ...('sort' in updates && { sort: updates.sort }),
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
      filters.excludeStatus?.length ||
      filters.board?.length ||
      filters.excludeBoard?.length ||
      filters.tags?.length ||
      filters.owner ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.minVotes
    )
  }, [filters])

  /**
   * Toggle a board's selection using smart include/exclude logic
   */
  const toggleBoard = useCallback(
    (boardId: string, allBoardIds: string[]) => {
      const result = toggleItem(allBoardIds, filters.board, filters.excludeBoard, boardId)
      setFilters({
        board: result.include,
        excludeBoard: result.exclude,
      })
    },
    [filters.board, filters.excludeBoard, setFilters]
  )

  /**
   * Toggle a status's selection using smart include/exclude logic
   */
  const toggleStatus = useCallback(
    (statusSlug: string, allStatusSlugs: string[]) => {
      const result = toggleItem(allStatusSlugs, filters.status, filters.excludeStatus, statusSlug)
      setFilters({
        status: result.include,
        excludeStatus: result.exclude,
      })
    },
    [filters.status, filters.excludeStatus, setFilters]
  )

  /**
   * Check if a board is currently selected
   */
  const isBoardSelected = useCallback(
    (boardId: string) => {
      return isItemSelected(boardId, filters.board, filters.excludeBoard)
    },
    [filters.board, filters.excludeBoard]
  )

  /**
   * Check if a status is currently selected
   */
  const isStatusSelected = useCallback(
    (statusSlug: string) => {
      return isItemSelected(statusSlug, filters.status, filters.excludeStatus)
    },
    [filters.status, filters.excludeStatus]
  )

  return {
    filters,
    setFilters,
    clearFilters,
    selectedPostId,
    setSelectedPostId,
    hasActiveFilters,
    toggleBoard,
    toggleStatus,
    isBoardSelected,
    isStatusSelected,
  }
}
