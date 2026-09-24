import {
  useInfiniteQuery,
  infiniteQueryOptions,
  keepPreviousData,
  type InfiniteData,
} from '@tanstack/react-query'
import type {
  RoadmapPost,
  RoadmapPostListResult,
  RoadmapPostsListResult,
  RoadmapViewPost,
} from '@/lib/shared/types'
import type { RoadmapId, PostStatusId } from '@quackback/ids'
import type { RoadmapFilters } from '@/lib/shared/types'
import { getRoadmapColumnsFn, getRoadmapPostsFn } from '@/lib/server/functions/roadmaps'
import { getRoadmapPostsByStatusFn } from '@/lib/server/functions/public-posts'

// ============================================================================
// Types
// ============================================================================

interface UseRoadmapPostsOptions {
  statusId: PostStatusId
  initialData?: RoadmapPostListResult
}

interface UseRoadmapPostsByRoadmapOptions {
  roadmapId: RoadmapId
  statusId?: PostStatusId
  bucketId?: string
  filters?: RoadmapFilters
  enabled?: boolean
}

interface UsePublicRoadmapPostsOptions {
  roadmapId: RoadmapId
  statusId?: PostStatusId
  bucketId?: string
  filters?: RoadmapFilters
  enabled?: boolean
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapPostsKeys = {
  all: ['roadmapPosts'] as const,
  lists: () => [...roadmapPostsKeys.all, 'list'] as const,
  list: (statusId: PostStatusId) => [...roadmapPostsKeys.lists(), statusId] as const,
  byRoadmap: (
    roadmapId: RoadmapId,
    statusId?: PostStatusId,
    bucketId?: string,
    filters?: RoadmapFilters
  ) =>
    [
      ...roadmapPostsKeys.all,
      'roadmap',
      roadmapId,
      statusId ?? bucketId ?? 'all',
      filters ?? {},
    ] as const,
  portal: (
    roadmapId: RoadmapId,
    statusId?: PostStatusId,
    bucketId?: string,
    filters?: RoadmapFilters
  ) => ['portal', 'roadmapPosts', roadmapId, statusId ?? bucketId, filters ?? {}] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

export function useRoadmapPosts({ statusId, initialData }: UseRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.list(statusId),
    queryFn: ({ pageParam }) =>
      getRoadmapPostsByStatusFn({
        data: { statusId, page: pageParam, limit: 10 },
      }) as Promise<RoadmapPostListResult>,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    // Page number inverts trivially (page - 1); no live consumer currently
    // imports this hook (admin-tier cap applied for when one does).
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 1 ? firstPageParam - 1 : undefined,
    maxPages: 5,
    initialData: initialData ? { pages: [initialData], pageParams: [1] } : undefined,
    refetchOnMount: !initialData,
    placeholderData: keepPreviousData,
  })
}

export function useRoadmapPostsByRoadmap({
  enabled = true,
  ...column
}: UseRoadmapPostsByRoadmapOptions) {
  return useInfiniteQuery({ ...roadmapPostsByRoadmapOptions(column), enabled })
}

const COLUMN_PAGE_SIZE = 20

function columnFilterInput(roadmapId: RoadmapId, filters: RoadmapFilters | undefined) {
  return {
    roadmapId,
    limit: COLUMN_PAGE_SIZE,
    search: filters?.search,
    boardIds: filters?.board,
    tagIds: filters?.tags,
    segmentIds: filters?.segmentIds,
    sort: filters?.sort,
  }
}

type RoadmapColumnRef = { statusId?: PostStatusId; bucketId?: string }

interface FirstPageBatch {
  input: ReturnType<typeof columnFilterInput>
  columns: RoadmapColumnRef[]
  waiters: { resolve: (page: RoadmapPostsListResult) => void; reject: (error: unknown) => void }[]
}

/**
 * First pages asked for in the same tick for the same board and filters (the
 * board opening, a filter change, a drag refreshing two columns), waiting to
 * go out as one getRoadmapColumnsFn request.
 */
const pendingFirstPages = new Map<string, FirstPageBatch>()

function fetchColumnFirstPage(
  roadmapId: RoadmapId,
  column: RoadmapColumnRef,
  filters: RoadmapFilters | undefined
): Promise<RoadmapPostsListResult> {
  const input = columnFilterInput(roadmapId, filters)
  const key = JSON.stringify(input)
  let batch = pendingFirstPages.get(key)
  if (!batch) {
    const created: FirstPageBatch = { input, columns: [], waiters: [] }
    pendingFirstPages.set(key, created)
    queueMicrotask(() => void sendFirstPages(key, created))
    batch = created
  }
  const { columns, waiters } = batch
  return new Promise((resolve, reject) => {
    columns.push(column)
    waiters.push({ resolve, reject })
  })
}

async function sendFirstPages(key: string, batch: FirstPageBatch) {
  pendingFirstPages.delete(key)
  try {
    const pages = (await getRoadmapColumnsFn({
      data: { ...batch.input, columns: batch.columns },
    })) as RoadmapPostsListResult[]
    batch.waiters.forEach((waiter, i) => waiter.resolve(pages[i]!))
  } catch (error) {
    for (const waiter of batch.waiters) waiter.reject(error)
  }
}

/**
 * One admin roadmap column's posts, a page of 20 at a time. First pages load
 * together with the board's other columns (see fetchColumnFirstPage); later
 * pages load for their column alone.
 */
export function roadmapPostsByRoadmapOptions({
  roadmapId,
  statusId,
  bucketId,
  filters,
}: Omit<UseRoadmapPostsByRoadmapOptions, 'enabled'>) {
  return infiniteQueryOptions({
    queryKey: roadmapPostsKeys.byRoadmap(roadmapId, statusId, bucketId, filters),
    queryFn: ({ pageParam }) =>
      pageParam === 0
        ? fetchColumnFirstPage(roadmapId, { statusId, bucketId }, filters)
        : (getRoadmapPostsFn({
            data: {
              ...columnFilterInput(roadmapId, filters),
              statusId,
              bucketId,
              offset: pageParam,
            },
          }) as Promise<RoadmapPostsListResult>),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * COLUMN_PAGE_SIZE : undefined,
    // Offset inverts trivially (offset - 20, floored at 0) — admin board.
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 0 ? Math.max(0, firstPageParam - COLUMN_PAGE_SIZE) : undefined,
    maxPages: 5,
    placeholderData: keepPreviousData,
  })
}

export function usePublicRoadmapPosts({
  roadmapId,
  statusId,
  bucketId,
  filters,
  enabled = true,
}: UsePublicRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.portal(roadmapId, statusId, bucketId, filters),
    queryFn: async ({ pageParam = 0 }) => {
      const { fetchPublicRoadmapPosts } = await import('@/lib/server/functions/portal')
      return fetchPublicRoadmapPosts({
        data: {
          roadmapId,
          statusId,
          bucketId,
          limit: 20,
          offset: pageParam,
          search: filters?.search,
          boardIds: filters?.board,
          tagIds: filters?.tags,
          segmentIds: filters?.segmentIds,
          sort: filters?.sort,
        },
      }) as Promise<RoadmapPostsListResult>
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * 20 : undefined),
    // Offset inverts trivially (offset - 20, floored at 0) — visitor-facing
    // roadmap board, so the wider scroll-back cap.
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 0 ? Math.max(0, firstPageParam - 20) : undefined,
    maxPages: 8,
    placeholderData: keepPreviousData,
    enabled,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Flatten paginated roadmap posts into a single array */
export function flattenRoadmapPosts(
  data: InfiniteData<RoadmapPostListResult> | undefined
): RoadmapPost[] {
  if (!data?.pages) return []
  return data.pages.flatMap((page) => page?.items ?? []).filter((item) => item?.id)
}

/** Flatten paginated posts returned by a derived roadmap view. */
export function flattenRoadmapViewPosts(
  data: InfiniteData<RoadmapPostsListResult> | undefined
): RoadmapViewPost[] {
  if (!data?.pages) return []
  return data.pages.flatMap((page) => page?.items ?? []).filter((item) => item?.id)
}
