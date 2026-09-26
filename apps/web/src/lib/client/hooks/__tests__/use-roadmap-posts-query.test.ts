/**
 * An admin roadmap board loads one query per column. The columns' first
 * pages, asked for together (the board opening, a filter change, a drag
 * refreshing two columns), go out as one request; later pages still load a
 * column at a time.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostStatusId, RoadmapId } from '@quackback/ids'

const getRoadmapPostsFn = vi.fn()
const getRoadmapColumnsFn = vi.fn()
vi.mock('@/lib/server/functions/roadmaps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/roadmaps')>()),
  getRoadmapPostsFn: (...args: unknown[]) => getRoadmapPostsFn(...args),
  getRoadmapColumnsFn: (...args: unknown[]) => getRoadmapColumnsFn(...args),
}))

const { roadmapPostsByRoadmapOptions } = await import('../use-roadmap-posts-query')

const ROADMAP = 'roadmap_01h455vb4pex5vsknk084sn02q' as RoadmapId
const PLANNED = 'post_status_planned' as PostStatusId
const BUILDING = 'post_status_building' as PostStatusId
const SHIPPED = 'post_status_shipped' as PostStatusId

function page(label: string, hasMore = false) {
  return { items: [{ id: label }], total: 1, hasMore }
}

let client: QueryClient
beforeEach(() => {
  getRoadmapPostsFn.mockReset()
  getRoadmapColumnsFn.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
