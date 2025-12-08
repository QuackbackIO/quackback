'use client'

import {
  useQueryState,
  useQueryStates,
  parseAsArrayOf,
  parseAsString,
  parseAsInteger,
  parseAsStringLiteral,
} from 'nuqs'
import { useMemo, useCallback } from 'react'
import type { PostStatus } from '@quackback/db/types'

const POST_STATUSES = [
  'open',
  'under_review',
  'planned',
  'in_progress',
  'complete',
  'closed',
] as const
const SORT_OPTIONS = ['newest', 'oldest', 'votes'] as const

export interface InboxFilters {
  search?: string
  status?: PostStatus[]
  board?: string[]
  tags?: string[]
  owner?: string | 'unassigned'
  dateFrom?: string
  dateTo?: string
  minVotes?: number
  sort?: 'newest' | 'oldest' | 'votes'
}

// Define parsers for each filter
const filterParsers = {
  search: parseAsString,
  status: parseAsArrayOf(parseAsStringLiteral(POST_STATUSES)),
  board: parseAsArrayOf(parseAsString),
  tags: parseAsArrayOf(parseAsString),
  owner: parseAsString,
  dateFrom: parseAsString,
  dateTo: parseAsString,
  minVotes: parseAsInteger,
  sort: parseAsStringLiteral(SORT_OPTIONS),
}

export function useInboxFilters() {
  // Use useQueryStates for all filters at once
  // shallow: true prevents server-side re-render when URL changes
  const [filterState, setFilterState] = useQueryStates(filterParsers, {
    shallow: true,
  })

  // Separate state for selected post
  const [selectedPostId, setSelectedPostId] = useQueryState('selected', {
    shallow: true,
  })

  // Convert null values to undefined for cleaner interface
  const filters: InboxFilters = useMemo(
    () => ({
      search: filterState.search ?? undefined,
      status: filterState.status?.length ? (filterState.status as PostStatus[]) : undefined,
      board: filterState.board?.length ? filterState.board : undefined,
      tags: filterState.tags?.length ? filterState.tags : undefined,
      owner: filterState.owner ?? undefined,
      dateFrom: filterState.dateFrom ?? undefined,
      dateTo: filterState.dateTo ?? undefined,
      minVotes: filterState.minVotes ?? undefined,
      sort: filterState.sort ?? undefined,
    }),
    [filterState]
  )

  const setFilters = useCallback(
    (updates: Partial<InboxFilters>) => {
      // Convert undefined to null for nuqs
      const nuqsUpdates: Record<string, unknown> = {}

      if ('search' in updates) nuqsUpdates.search = updates.search ?? null
      if ('status' in updates) nuqsUpdates.status = updates.status ?? null
      if ('board' in updates) nuqsUpdates.board = updates.board ?? null
      if ('tags' in updates) nuqsUpdates.tags = updates.tags ?? null
      if ('owner' in updates) nuqsUpdates.owner = updates.owner ?? null
      if ('dateFrom' in updates) nuqsUpdates.dateFrom = updates.dateFrom ?? null
      if ('dateTo' in updates) nuqsUpdates.dateTo = updates.dateTo ?? null
      if ('minVotes' in updates) nuqsUpdates.minVotes = updates.minVotes ?? null
      if ('sort' in updates) nuqsUpdates.sort = updates.sort ?? null

      setFilterState(nuqsUpdates as Partial<typeof filterState>)
    },
    [setFilterState]
  )

  const clearFilters = useCallback(() => {
    setFilterState(null)
  }, [setFilterState])

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
