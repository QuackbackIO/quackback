import {
  useInfiniteQuery,
  infiniteQueryOptions,
  keepPreviousData,
  type InfiniteData,
  type QueryClient,
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

interface RoadmapColumnQueryOptions {
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

export function useRoadmapPostsByRoadmap({ enabled = true, ...column }: RoadmapColumnQueryOptions) {
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

type ColumnFilterInput = ReturnType<typeof columnFilterInput>

type FetchColumns = (
  data: ColumnFilterInput & { columns: RoadmapColumnRef[] }
) => Promise<RoadmapPostsListResult[]>

interface FirstPageBatch {
  input: ColumnFilterInput
  columns: RoadmapColumnRef[]
  waiters: { resolve: (page: RoadmapPostsListResult) => void; reject: (error: unknown) => void }[]
}

/**
 * A function that fetches one column's first page, batching the first pages
 * asked for in the same tick for the same board and filters (the board
 * opening, a filter change, a drag refreshing two columns) into one
 * fetchColumns call, split by fetchInChunks.
 */
function createFirstPageBatcher(fetchColumns: FetchColumns) {
  const pending = new Map<string, FirstPageBatch>()

  async function send(key: string, batch: FirstPageBatch) {
    pending.delete(key)
    try {
      const pages = await fetchInChunks(batch.columns, (columns) =>
        fetchColumns({ ...batch.input, columns })
      )
      batch.waiters.forEach((waiter, i) => waiter.resolve(pages[i]!))
    } catch (error) {
      for (const waiter of batch.waiters) waiter.reject(error)
    }
  }

  return function fetchFirstPage(
    roadmapId: RoadmapId,
    column: RoadmapColumnRef,
    filters: RoadmapFilters | undefined
  ): Promise<RoadmapPostsListResult> {
    const input = columnFilterInput(roadmapId, filters)
    const key = JSON.stringify(input)
    let batch = pending.get(key)
    if (!batch) {
      const created: FirstPageBatch = { input, columns: [], waiters: [] }
      pending.set(key, created)
      queueMicrotask(() => void send(key, created))
      batch = created
    }
    const { columns, waiters } = batch
    return new Promise((resolve, reject) => {
      columns.push(column)
      waiters.push({ resolve, reject })
    })
  }
}

/** The most columns one first-page request may carry: the server's limit. */
const MAX_COLUMNS_PER_REQUEST = 50

/**
 * A batch's first pages, fetched in requests of at most
 * MAX_COLUMNS_PER_REQUEST columns (a date board can span more periods than
 * that) and returned in the batch's column order.
 */
async function fetchInChunks<Column>(
  columns: Column[],
  fetchChunk: (columns: Column[]) => Promise<RoadmapPostsListResult[]>
): Promise<RoadmapPostsListResult[]> {
  const chunks: Column[][] = []
  for (let i = 0; i < columns.length; i += MAX_COLUMNS_PER_REQUEST) {
    chunks.push(columns.slice(i, i + MAX_COLUMNS_PER_REQUEST))
  }
  return (await Promise.all(chunks.map(fetchChunk))).flat()
}

const fetchColumnFirstPage = createFirstPageBatcher(
  async (data) => (await getRoadmapColumnsFn({ data })) as RoadmapPostsListResult[]
)

/**
 * The portal server functions, imported once however many requests ask at a
 * time; a failed import is tried again by the next.
 */
let portalFunctions: Promise<typeof import('@/lib/server/functions/portal')> | undefined
const loadPortalFunctions = () =>
  (portalFunctions ??= import('@/lib/server/functions/portal').catch((error: unknown) => {
    portalFunctions = undefined
    throw error
  }))

const fetchPublicColumnFirstPage = createFirstPageBatcher(async (data) => {
  const { fetchPublicRoadmapColumns } = await loadPortalFunctions()
  return (await fetchPublicRoadmapColumns({ data })) as RoadmapPostsListResult[]
})

/**
 * One admin roadmap column's posts, a page of 20 at a time. First pages load
 * together with the board's other columns (see createFirstPageBatcher); later
 * pages load for their column alone.
 */
export function roadmapPostsByRoadmapOptions({
  roadmapId,
  statusId,
  bucketId,
  filters,
}: Omit<RoadmapColumnQueryOptions, 'enabled'>) {
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
    // Offset inverts trivially (offset - 20, floored at 0), admin board.
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 0 ? Math.max(0, firstPageParam - COLUMN_PAGE_SIZE) : undefined,
    maxPages: 5,
    placeholderData: keepPreviousData,
  })
}

/**
 * Put the first page of each of a board's columns in the cache with one
 * getRoadmapColumnsFn request, for a route loader. It asks directly rather
 * than through fetchColumnFirstPage's batch, which is shared by everything
 * running in the process: on a server that could hand one request's columns
 * to another.
 */
export async function warmRoadmapColumns(
  queryClient: QueryClient,
  roadmapId: RoadmapId,
  columns: readonly { statusId: PostStatusId }[],
  filters: RoadmapFilters
): Promise<void> {
  const keyOf = (statusId: PostStatusId) =>
    roadmapPostsByRoadmapOptions({ roadmapId, statusId, filters }).queryKey
  const missing = columns.filter((c) => queryClient.getQueryData(keyOf(c.statusId)) === undefined)
  if (missing.length === 0) return
  const pages = (await getRoadmapColumnsFn({
    data: {
      ...columnFilterInput(roadmapId, filters),
      columns: missing.map((c) => ({ statusId: c.statusId })),
    },
  })) as RoadmapPostsListResult[]
  missing.forEach((column, i) => {
    queryClient.setQueryData<InfiniteData<RoadmapPostsListResult, number>>(keyOf(column.statusId), {
      pages: [pages[i]!],
      pageParams: [0],
    })
  })
}

/**
 * One public roadmap column's posts, a page of 20 at a time. First pages
 * load together with the board's other columns (see createFirstPageBatcher);
 * later pages load for their column alone.
 */
export function publicRoadmapPostsOptions({
  roadmapId,
  statusId,
  bucketId,
  filters,
}: Omit<RoadmapColumnQueryOptions, 'enabled'>) {
  return infiniteQueryOptions({
    queryKey: roadmapPostsKeys.portal(roadmapId, statusId, bucketId, filters),
    queryFn: async ({ pageParam = 0 }) => {
      if (pageParam === 0) {
        return fetchPublicColumnFirstPage(roadmapId, { statusId, bucketId }, filters)
      }
      const { fetchPublicRoadmapPosts } = await loadPortalFunctions()
      return fetchPublicRoadmapPosts({
        data: { ...columnFilterInput(roadmapId, filters), statusId, bucketId, offset: pageParam },
      }) as Promise<RoadmapPostsListResult>
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * COLUMN_PAGE_SIZE : undefined,
    // Offset inverts trivially (offset - 20, floored at 0), visitor-facing
    // roadmap board, so the wider scroll-back cap.
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 0 ? Math.max(0, firstPageParam - COLUMN_PAGE_SIZE) : undefined,
    maxPages: 8,
    placeholderData: keepPreviousData,
  })
}

export function usePublicRoadmapPosts({ enabled = true, ...column }: RoadmapColumnQueryOptions) {
  return useInfiniteQuery({ ...publicRoadmapPostsOptions(column), enabled })
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
