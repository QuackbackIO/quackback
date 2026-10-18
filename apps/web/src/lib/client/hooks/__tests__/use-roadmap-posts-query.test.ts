// @vitest-environment happy-dom
/**
 * An admin roadmap board loads one query per column. The columns' first
 * pages, asked for together (the board opening, a filter change, a drag
 * refreshing two columns), go out as one request; later pages still load a
 * column at a time. The public portal roadmap board does the same over the
 * public endpoints.
 */
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostStatusId, RoadmapId } from '@quackback/ids'

const getRoadmapPostsFn = vi.fn()
const getRoadmapColumnsFn = vi.fn()
const getRoadmapPostsByStatusFn = vi.fn()
vi.mock('@/lib/server/functions/roadmaps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/roadmaps')>()),
  getRoadmapPostsFn: (...args: unknown[]) => getRoadmapPostsFn(...args),
  getRoadmapColumnsFn: (...args: unknown[]) => getRoadmapColumnsFn(...args),
}))
vi.mock('@/lib/server/functions/public-posts', () => ({
  getRoadmapPostsByStatusFn: (...args: unknown[]) => getRoadmapPostsByStatusFn(...args),
  listPublicPostsFn: vi.fn(),
  getVotedPostsFn: vi.fn(),
  getPostPermissionsFn: vi.fn(),
}))

const fetchPublicRoadmapPosts = vi.fn()
const fetchPublicRoadmapColumns = vi.fn()
vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicRoadmapPosts: (...args: unknown[]) => fetchPublicRoadmapPosts(...args),
  fetchPublicRoadmapColumns: (...args: unknown[]) => fetchPublicRoadmapColumns(...args),
}))

const { roadmapPostsByRoadmapOptions, publicRoadmapPostsOptions, useRoadmapPosts } =
  await import('../use-roadmap-posts-query')

const ROADMAP = 'roadmap_01h455vb4pex5vsknk084sn02q' as RoadmapId
const PLANNED = 'post_status_planned' as PostStatusId
const BUILDING = 'post_status_building' as PostStatusId
const SHIPPED = 'post_status_shipped' as PostStatusId

function page(label: string, hasMore = false) {
  return { items: [{ id: label }], total: 1, hasMore }
}

/** Mock a column endpoint whose later pages come by `offset`, `total` posts long. */
function offsetPages(total: number) {
  return async ({ data }: { data: { offset: number } }) => ({
    items: [{ id: `post_${data.offset}` }],
    total,
    hasMore: data.offset + 20 < total,
  })
}

function offsetsRequested(fn: ReturnType<typeof vi.fn>): number[] {
  return fn.mock.calls.map((call) => (call[0] as { data: { offset: number } }).data.offset)
}

let client: QueryClient
beforeEach(() => {
  getRoadmapPostsFn.mockReset()
  getRoadmapColumnsFn.mockReset()
  getRoadmapPostsByStatusFn.mockReset()
  fetchPublicRoadmapPosts.mockReset()
  fetchPublicRoadmapColumns.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(cleanup)

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children)
}

// Capped queries (`maxPages`) drop their oldest page on each append, so the
// next offset must come from the last page's own param, never from the page
// count — a count-based param re-requests one page forever (PRO-1664).
describe('page params past the maxPages cap', () => {
  it('admin column: advances the offset by 20 (maxPages 5)', async () => {
    getRoadmapColumnsFn.mockResolvedValue([
      { items: [{ id: 'post_0' }], total: 180, hasMore: true },
    ])
    getRoadmapPostsFn.mockImplementation(offsetPages(180))

    const data = await client.fetchInfiniteQuery({
      ...roadmapPostsByRoadmapOptions({ roadmapId: ROADMAP, statusId: PLANNED }),
      pages: 9,
    })

    expect(offsetsRequested(getRoadmapPostsFn)).toEqual([20, 40, 60, 80, 100, 120, 140, 160])
    expect(data.pageParams).toEqual([80, 100, 120, 140, 160])
    expect(data.pages.at(-1)?.hasMore).toBe(false)
  })

  it('public column: advances the offset by 20 (maxPages 8)', async () => {
    fetchPublicRoadmapColumns.mockResolvedValue([
      { items: [{ id: 'post_0' }], total: 220, hasMore: true },
    ])
    fetchPublicRoadmapPosts.mockImplementation(offsetPages(220))

    const data = await client.fetchInfiniteQuery({
      ...publicRoadmapPostsOptions({ roadmapId: ROADMAP, statusId: PLANNED }),
      pages: 11,
    })

    expect(offsetsRequested(fetchPublicRoadmapPosts)).toEqual([
      20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
    ])
    expect(data.pageParams).toEqual([60, 80, 100, 120, 140, 160, 180, 200])
    expect(data.pages.at(-1)?.hasMore).toBe(false)
  })

  it('per-status hook: advances the page number by 1 (maxPages 5)', async () => {
    const LAST_PAGE = 9
    getRoadmapPostsByStatusFn.mockImplementation(async ({ data }: { data: { page: number } }) => ({
      items: [{ id: `post_${data.page}` }],
      total: LAST_PAGE,
      hasMore: data.page < LAST_PAGE,
    }))

    const { result } = renderHook(() => useRoadmapPosts({ statusId: PLANNED }), { wrapper })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    for (let page = 2; page <= LAST_PAGE; page++) {
      await act(async () => {
        await result.current.fetchNextPage()
      })
    }
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))

    const pages = getRoadmapPostsByStatusFn.mock.calls.map(
      (call) => (call[0] as { data: { page: number } }).data.page
    )
    expect(pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(result.current.data?.pageParams).toEqual([5, 6, 7, 8, 9])
  })
})

describe('roadmapPostsByRoadmapOptions', () => {
  it("loads the columns' first pages in one request", async () => {
    getRoadmapColumnsFn.mockResolvedValueOnce([page('planned'), page('building'), page('shipped')])
    const filters = { sort: 'votes' as const }

    const [planned, building, shipped] = await Promise.all(
      [PLANNED, BUILDING, SHIPPED].map((statusId) =>
        client.fetchInfiniteQuery(
          roadmapPostsByRoadmapOptions({ roadmapId: ROADMAP, statusId, filters })
        )
      )
    )

    expect(getRoadmapColumnsFn).toHaveBeenCalledTimes(1)
    expect(getRoadmapColumnsFn).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roadmapId: ROADMAP,
        limit: 20,
        sort: 'votes',
        columns: [{ statusId: PLANNED }, { statusId: BUILDING }, { statusId: SHIPPED }],
      }),
    })
    expect(getRoadmapPostsFn).not.toHaveBeenCalled()
    expect(planned.pages[0]).toEqual(page('planned'))
    expect(building.pages[0]).toEqual(page('building'))
    expect(shipped.pages[0]).toEqual(page('shipped'))
  })

  it('splits more columns than one request may carry', async () => {
    getRoadmapColumnsFn.mockImplementation(
      async ({ data }: { data: { columns: { bucketId: string }[] } }) =>
        data.columns.map((column) => page(column.bucketId))
    )
    const buckets = Array.from({ length: 51 }, (_, i) => `2026-${i}`)

    const results = await Promise.all(
      buckets.map((bucketId) =>
        client.fetchInfiniteQuery(roadmapPostsByRoadmapOptions({ roadmapId: ROADMAP, bucketId }))
      )
    )

    const sizes = getRoadmapColumnsFn.mock.calls.map(([arg]) => arg.data.columns.length)
    expect(sizes).toEqual([50, 1])
    expect(results.map((r) => r.pages[0])).toEqual(buckets.map((b) => page(b)))
  })

  it('keeps boards with different filters in separate requests', async () => {
    getRoadmapColumnsFn
      .mockResolvedValueOnce([page('votes')])
      .mockResolvedValueOnce([page('newest')])

    const [byVotes, byNewest] = await Promise.all([
      client.fetchInfiniteQuery(
        roadmapPostsByRoadmapOptions({
          roadmapId: ROADMAP,
          statusId: PLANNED,
          filters: { sort: 'votes' },
        })
      ),
      client.fetchInfiniteQuery(
        roadmapPostsByRoadmapOptions({
          roadmapId: ROADMAP,
          statusId: PLANNED,
          filters: { sort: 'newest' },
        })
      ),
    ])

    expect(getRoadmapColumnsFn).toHaveBeenCalledTimes(2)
    expect(byVotes.pages[0]).toEqual(page('votes'))
    expect(byNewest.pages[0]).toEqual(page('newest'))
  })

  it('fails every column of a failed request', async () => {
    getRoadmapColumnsFn.mockRejectedValueOnce(new Error('boom'))

    const results = await Promise.allSettled(
      [PLANNED, BUILDING].map((statusId) =>
        client.fetchInfiniteQuery(roadmapPostsByRoadmapOptions({ roadmapId: ROADMAP, statusId }))
      )
    )

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
  })

  it('loads a later page for its column alone', async () => {
    getRoadmapColumnsFn.mockResolvedValue([page('first', true)])
    getRoadmapPostsFn.mockResolvedValueOnce(page('second'))
    const options = roadmapPostsByRoadmapOptions({ roadmapId: ROADMAP, statusId: PLANNED })

    await client.fetchInfiniteQuery(options)
    const data = await client.fetchInfiniteQuery({ ...options, pages: 2 })

    expect(getRoadmapPostsFn).toHaveBeenCalledWith({
      data: expect.objectContaining({ roadmapId: ROADMAP, statusId: PLANNED, offset: 20 }),
    })
    expect(data.pages).toEqual([page('first', true), page('second')])
  })
})

describe('publicRoadmapPostsOptions', () => {
  it('splits more columns than one request may carry', async () => {
    fetchPublicRoadmapColumns.mockImplementation(
      async ({ data }: { data: { columns: { bucketId: string }[] } }) =>
        data.columns.map((column) => page(column.bucketId))
    )
    const buckets = Array.from({ length: 51 }, (_, i) => `2026-${i}`)

    const results = await Promise.all(
      buckets.map((bucketId) =>
        client.fetchInfiniteQuery(publicRoadmapPostsOptions({ roadmapId: ROADMAP, bucketId }))
      )
    )

    const sizes = fetchPublicRoadmapColumns.mock.calls.map(([arg]) => arg.data.columns.length)
    expect(sizes).toEqual([50, 1])
    expect(results.map((r) => r.pages[0])).toEqual(buckets.map((b) => page(b)))
  })

  it("loads the columns' first pages in one request", async () => {
    fetchPublicRoadmapColumns.mockResolvedValueOnce([
      page('planned'),
      page('building'),
      page('shipped'),
    ])
    const filters = { sort: 'votes' as const }

    const [planned, building, shipped] = await Promise.all(
      [PLANNED, BUILDING, SHIPPED].map((statusId) =>
        client.fetchInfiniteQuery(
          publicRoadmapPostsOptions({ roadmapId: ROADMAP, statusId, filters })
        )
      )
    )

    expect(fetchPublicRoadmapColumns).toHaveBeenCalledTimes(1)
    expect(fetchPublicRoadmapColumns).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roadmapId: ROADMAP,
        limit: 20,
        sort: 'votes',
        columns: [{ statusId: PLANNED }, { statusId: BUILDING }, { statusId: SHIPPED }],
      }),
    })
    expect(fetchPublicRoadmapPosts).not.toHaveBeenCalled()
    expect(planned.pages[0]).toEqual(page('planned'))
    expect(building.pages[0]).toEqual(page('building'))
    expect(shipped.pages[0]).toEqual(page('shipped'))
  })

  // Sequential, not concurrent (unlike the admin equivalent above): both
  // filter sets touch the mocked portal module's dynamic import for the
  // first time in the same tick, which races vitest's mock registration for
  // the second one. A real fetch has no such call to race; this is a test
  // environment quirk of concurrent first-touch dynamic imports, not a
  // behavior this hook can see. Awaiting one board fully before opening the
  // next still proves two different filter sets never share a batch.
  it('keeps boards with different filters in separate requests', async () => {
    fetchPublicRoadmapColumns.mockResolvedValueOnce([page('votes')])
    const byVotes = await client.fetchInfiniteQuery(
      publicRoadmapPostsOptions({
        roadmapId: ROADMAP,
        statusId: PLANNED,
        filters: { sort: 'votes' },
      })
    )

    fetchPublicRoadmapColumns.mockResolvedValueOnce([page('newest')])
    const byNewest = await client.fetchInfiniteQuery(
      publicRoadmapPostsOptions({
        roadmapId: ROADMAP,
        statusId: PLANNED,
        filters: { sort: 'newest' },
      })
    )

    expect(fetchPublicRoadmapColumns).toHaveBeenCalledTimes(2)
    expect(byVotes.pages[0]).toEqual(page('votes'))
    expect(byNewest.pages[0]).toEqual(page('newest'))
  })

  it('fails every column of a failed request', async () => {
    fetchPublicRoadmapColumns.mockRejectedValueOnce(new Error('boom'))

    const results = await Promise.allSettled(
      [PLANNED, BUILDING].map((statusId) =>
        client.fetchInfiniteQuery(publicRoadmapPostsOptions({ roadmapId: ROADMAP, statusId }))
      )
    )

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
  })

  it('loads a later page for its column alone', async () => {
    fetchPublicRoadmapColumns.mockResolvedValue([page('first', true)])
    fetchPublicRoadmapPosts.mockResolvedValueOnce(page('second'))
    const options = publicRoadmapPostsOptions({ roadmapId: ROADMAP, statusId: PLANNED })

    await client.fetchInfiniteQuery(options)
    const data = await client.fetchInfiniteQuery({ ...options, pages: 2 })

    expect(fetchPublicRoadmapPosts).toHaveBeenCalledWith({
      data: expect.objectContaining({ roadmapId: ROADMAP, statusId: PLANNED, offset: 20 }),
    })
    expect(data.pages).toEqual([page('first', true), page('second')])
  })
})
