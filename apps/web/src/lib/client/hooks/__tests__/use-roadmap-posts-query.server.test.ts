// @vitest-environment happy-dom
/**
 * On a server, the columns' first pages are not batched: the pending batches
 * live in module state every request in the process shares, and the batch
 * runs under the request that opened it, so batching there could answer one
 * visitor's columns with another's view of the board.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostStatusId, RoadmapId } from '@quackback/ids'

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  isServer: true,
}))

const getRoadmapColumnsFn = vi.fn()
vi.mock('@/lib/server/functions/roadmaps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/roadmaps')>()),
  getRoadmapColumnsFn: (...args: unknown[]) => getRoadmapColumnsFn(...args),
}))

const fetchPublicRoadmapColumns = vi.fn()
vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicRoadmapPosts: vi.fn(),
  fetchPublicRoadmapColumns: (...args: unknown[]) => fetchPublicRoadmapColumns(...args),
}))

const { roadmapPostsByRoadmapOptions, publicRoadmapPostsOptions } =
  await import('../use-roadmap-posts-query')

const ROADMAP = 'roadmap_01h455vb4pex5vsknk084sn02q' as RoadmapId
const PLANNED = 'post_status_planned' as PostStatusId
const SHIPPED = 'post_status_shipped' as PostStatusId

const answerEachColumn = async ({ data }: { data: { columns: { statusId: string }[] } }) =>
  data.columns.map((column) => ({ items: [{ id: column.statusId }], total: 1, hasMore: false }))

beforeEach(() => {
  getRoadmapColumnsFn.mockReset().mockImplementation(answerEachColumn)
  fetchPublicRoadmapColumns.mockReset().mockImplementation(answerEachColumn)
})

describe('first pages on a server', () => {
  it('fetch each admin column in its own request', async () => {
    // Two requests rendering the same board with the same filters at once.
    const pages = await Promise.all(
      [PLANNED, SHIPPED].map((statusId) =>
        new QueryClient().fetchInfiniteQuery(
          roadmapPostsByRoadmapOptions({ roadmapId: ROADMAP, statusId, filters: {} })
        )
      )
    )
    expect(getRoadmapColumnsFn).toHaveBeenCalledTimes(2)
    expect(pages.map((p) => p.pages[0]!.items[0]!.id)).toEqual([PLANNED, SHIPPED])
  })

  it('fetch each public column in its own request', async () => {
    const pages = await Promise.all(
      [PLANNED, SHIPPED].map((statusId) =>
        new QueryClient().fetchInfiniteQuery(
          publicRoadmapPostsOptions({ roadmapId: ROADMAP, statusId, filters: {} })
        )
      )
    )
    expect(fetchPublicRoadmapColumns).toHaveBeenCalledTimes(2)
    expect(pages.map((p) => p.pages[0]!.items[0]!.id)).toEqual([PLANNED, SHIPPED])
  })
})
