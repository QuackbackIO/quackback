/**
 * Changelog Queries
 *
 * Query key factories and query options for changelog data.
 */

import { queryOptions, infiniteQueryOptions } from '@tanstack/react-query'
import type { ChangelogId } from '@quackback/ids'
import {
  listChangelogsFn,
  getChangelogFn,
  listChangelogTaxonomyFn,
  listPublicChangelogsFn,
  getPublicChangelogFn,
  listPublicChangelogTaxonomyFn,
} from '@/lib/server/functions/changelog'

const STALE_TIME_SHORT = 30 * 1000
const STALE_TIME_MEDIUM = 60 * 1000

/**
 * Query key factory for changelogs
 */
export const changelogKeys = {
  all: ['changelogs'] as const,
  lists: () => [...changelogKeys.all, 'list'] as const,
  list: (filters: { status?: string }) => [...changelogKeys.lists(), filters] as const,
  taxonomy: () => [...changelogKeys.all, 'taxonomy'] as const,
  details: () => [...changelogKeys.all, 'detail'] as const,
  detail: (id: ChangelogId) => [...changelogKeys.details(), id] as const,
  public: () => [...changelogKeys.all, 'public'] as const,
  publicList: () => [...changelogKeys.public(), 'list'] as const,
  publicDetail: (id: ChangelogId) => [...changelogKeys.public(), 'detail', id] as const,
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
      staleTime: STALE_TIME_SHORT,
    }),

  detail: (id: ChangelogId) =>
    queryOptions({
      queryKey: changelogKeys.detail(id),
      queryFn: () => getChangelogFn({ data: { id } }),
      staleTime: STALE_TIME_MEDIUM,
    }),

  taxonomy: () =>
    queryOptions({
      queryKey: changelogKeys.taxonomy(),
      queryFn: () => listChangelogTaxonomyFn(),
      staleTime: STALE_TIME_MEDIUM,
    }),
}

/**
 * Public changelog queries
 */
export const publicChangelogQueries = {
  list: (params?: {
    headers?: Record<string, string>
    selectedCategoryId?: string
    selectedProductId?: string
    visibilityCategoryIds?: string[] | null
    visibilityProductIds?: string[] | null
  }) =>
    infiniteQueryOptions({
      queryKey: [
        ...changelogKeys.publicList(),
        params?.headers?.['X-Quackback-Widget-Context'],
        params?.selectedCategoryId,
        params?.selectedProductId,
      ] as const,
      queryFn: ({ pageParam }) =>
        listPublicChangelogsFn({
          data: {
            cursor: pageParam,
            limit: 10,
            selectedCategoryId: params?.selectedCategoryId,
            selectedProductId: params?.selectedProductId,
            visibilityCategoryIds: params?.visibilityCategoryIds,
            visibilityProductIds: params?.visibilityProductIds,
          },
          headers: params?.headers,
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: STALE_TIME_MEDIUM,
    }),

  detail: (id: ChangelogId, headers?: Record<string, string>) =>
    queryOptions({
      queryKey: [
        ...changelogKeys.publicDetail(id),
        headers?.['X-Quackback-Widget-Context'],
      ] as const,
      queryFn: () => getPublicChangelogFn({ data: { id }, headers }),
      staleTime: STALE_TIME_MEDIUM,
    }),
}

/** Key factory for public changelog filter taxonomy */
export const publicChangelogFilterKeys = {
  taxonomy: () => ['changelogs', 'public', 'taxonomy'] as const,
}

/**
 * Public taxonomy query (categories + products) for the portal filter bar.
 */
export const publicChangelogTaxonomyQuery = () =>
  queryOptions({
    queryKey: publicChangelogFilterKeys.taxonomy(),
    queryFn: () => listPublicChangelogTaxonomyFn(),
    staleTime: 5 * 60 * 1000, // 5 min
  })
