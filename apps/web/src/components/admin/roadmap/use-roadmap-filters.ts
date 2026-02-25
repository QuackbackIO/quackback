import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/roadmap'
import { useMemo, useCallback } from 'react'
import { toggleItem } from '../feedback/filter-utils'
import type { RoadmapFilters } from '@/lib/shared/types'

export function useRoadmapFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: RoadmapFilters = useMemo(
    () => ({
      search: search.search,
      board: search.board?.length ? search.board : undefined,
      tags: search.tags?.length ? search.tags : undefined,
      segmentIds: search.segments?.length ? search.segments : undefined,
      sort: search.sort,
    }),
    [search]
  )

  const setFilters = useCallback(
    (updates: Partial<RoadmapFilters>) => {
      void navigate({
        to: '/admin/roadmap',
        search: {
          ...search,
          ...('search' in updates && { search: updates.search }),
          ...('board' in updates && { board: updates.board }),
          ...('tags' in updates && { tags: updates.tags }),
          ...('segmentIds' in updates && { segments: updates.segmentIds }),
          ...('sort' in updates && { sort: updates.sort }),
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const clearFilters = useCallback(() => {
    void navigate({
      to: '/admin/roadmap',
      search: { roadmap: search.roadmap, post: search.post },
      replace: true,
    })
  }, [navigate, search])

  const toggleBoard = useCallback(
    (boardId: string) => setFilters({ board: toggleItem(filters.board, boardId) }),
    [filters.board, setFilters]
  )

  const toggleTag = useCallback(
    (tagId: string) => setFilters({ tags: toggleItem(filters.tags, tagId) }),
    [filters.tags, setFilters]
  )

  const toggleSegment = useCallback(
    (segmentId: string) => setFilters({ segmentIds: toggleItem(filters.segmentIds, segmentId) }),
    [filters.segmentIds, setFilters]
  )

  return {
    filters,
    setFilters,
    clearFilters,
    toggleBoard,
    toggleTag,
    toggleSegment,
  }
}
