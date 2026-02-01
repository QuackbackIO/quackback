/**
 * Changelog Queries
 *
 * Query key factories and query options for changelog data.
 */

import { queryOptions, infiniteQueryOptions } from '@tanstack/react-query'
import type { BoardId, ChangelogId } from '@quackback/ids'
import {
  listChangelogsFn,
  getChangelogFn,
  listPublicChangelogsFn,
  getPublicChangelogFn,
} from '@/lib/server/functions/changelog'

const STALE_TIME_SHORT = 30 * 1000
const STALE_TIME_MEDIUM = 60 * 1000

/**
 * Query key factory for changelogs
 */
export const changelogKeys = {
  all: ['changelogs'] as const,
  lists: () => [...changelogKeys.all, 'list'] as const,
  list: (filters: { boardId?: BoardId; status?: string }) =>
    [...changelogKeys.lists(), filters] as const,
  details: () => [...changelogKeys.all, 'detail'] as const,
  detail: (id: ChangelogId) => [...changelogKeys.details(), id] as const,
  public: () => [...changelogKeys.all, 'public'] as const,
  publicList: (boardId?: BoardId) => [...changelogKeys.public(), 'list', boardId] as const,
  publicDetail: (id: ChangelogId) => [...changelogKeys.public(), 'detail', id] as const,
}

/**
 * Admin changelog queries
 */
export const changelogQueries = {
  list: (params: { boardId?: BoardId; status?: 'draft' | 'scheduled' | 'published' | 'all' }) =>
    infiniteQueryOptions({
      queryKey: changelogKeys.list(params),
      queryFn: ({ pageParam }) =>
        listChangelogsFn({
          data: {
            boardId: params.boardId,
            status: params.status,
            cursor: pageParam,
            limit: 20,
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: STALE_TIME_SHORT,
    }),

  detail: (id: ChangelogId) =>
    queryOptions({
      queryKey: changelogKeys.detail(id),
      queryFn: () => getChangelogFn({ data: { id } }),
      staleTime: STALE_TIME_MEDIUM,
    }),
}

/**
 * Public changelog queries
 */
export const publicChangelogQueries = {
  list: (boardId?: BoardId) =>
    infiniteQueryOptions({
      queryKey: changelogKeys.publicList(boardId),
      queryFn: ({ pageParam }) =>
        listPublicChangelogsFn({
          data: {
            boardId,
            cursor: pageParam,
            limit: 10,
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: STALE_TIME_MEDIUM,
    }),

  detail: (id: ChangelogId) =>
    queryOptions({
      queryKey: changelogKeys.publicDetail(id),
      queryFn: () => getPublicChangelogFn({ data: { id } }),
      staleTime: STALE_TIME_MEDIUM,
    }),
}
