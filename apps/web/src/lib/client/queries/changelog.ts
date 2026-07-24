/**
 * Changelog Queries
 *
 * Query key factories and query options for changelog data.
 */

import { queryOptions, infiniteQueryOptions, keepPreviousData } from '@tanstack/react-query'
import type { ChangelogId } from '@quackback/ids'
import {
  listChangelogsFn,
  getChangelogFn,
  listPublicChangelogsFn,
  getPublicChangelogFn,
} from '@/lib/server/functions/changelog'
import { listChangelogCategoriesFn } from '@/lib/server/functions/changelog-categories'
import { fetchChangelogSettingsFn } from '@/lib/server/functions/settings'

const STALE_TIME_SHORT = 30 * 1000
const STALE_TIME_MEDIUM = 60 * 1000

/**
 * Query key factory for changelogs
 */
export const changelogKeys = {
  all: ['changelogs'] as const,
  lists: () => [...changelogKeys.all, 'list'] as const,
  list: (filters: { status?: string }) => [...changelogKeys.lists(), filters] as const,
  details: () => [...changelogKeys.all, 'detail'] as const,
  detail: (id: ChangelogId) => [...changelogKeys.details(), id] as const,
  public: () => [...changelogKeys.all, 'public'] as const,
  publicList: () => [...changelogKeys.public(), 'list'] as const,
  publicDetail: (id: ChangelogId) => [...changelogKeys.public(), 'detail', id] as const,
  categories: () => [...changelogKeys.all, 'categories'] as const,
  settings: () => [...changelogKeys.all, 'settings'] as const,
}

/**
 * Changelog categories (labels). Public read (no auth required) — powers
 * the admin multi-select, the Labels settings card, and the public/widget
 * filter chips from a single query.
 */
export const changelogCategoryQueries = {
  list: () =>
    queryOptions({
      queryKey: changelogKeys.categories(),
      queryFn: () => listChangelogCategoriesFn(),
      staleTime: STALE_TIME_MEDIUM,
    }),
}

/** Admin-only changelog settings (Settings > Changelog, `changelog.manage`). */
export const changelogSettingsQueries = {
  get: () =>
    queryOptions({
      queryKey: changelogKeys.settings(),
      queryFn: () => fetchChangelogSettingsFn(),
      staleTime: STALE_TIME_MEDIUM,
    }),
}

/**
 * Admin changelog queries
 */
export const changelogQueries = {
  list: (params: { status?: 'draft' | 'scheduled' | 'published' | 'all' }) =>
    infiniteQueryOptions({
      queryKey: changelogKeys.list(params),
      queryFn: ({ pageParam }) =>
        listChangelogsFn({
          data: {
            status: params.status,
            cursor: pageParam,
            limit: 20,
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      // NOTE (QC-2): no `maxPages` — one-directional keyset cursor (last-entry
      // id, forward-only), no reverse cursor available server-side.
      staleTime: STALE_TIME_SHORT,
      placeholderData: keepPreviousData,
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
  list: () =>
    infiniteQueryOptions({
      queryKey: changelogKeys.publicList(),
      queryFn: ({ pageParam }) =>
        listPublicChangelogsFn({
          data: {
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
