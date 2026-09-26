// @vitest-environment happy-dom
/**
 * The admin roadmap route loader warms the board the URL opens: the roadmap
 * list and the first page of every column of the roadmap shown, in one
 * request. The server-rendered board is then complete, and the browser
 * fetches nothing more for it after hydration. The reads mounted here are the
 * board's own hooks with the unfiltered board's filters, so a column the
 * loader misses shows up as a fetch on mount.
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostStatusId, RoadmapId } from '@quackback/ids'

const calls: string[] = []
function stub<T>(name: string, value: T | ((args: unknown) => T)) {
  return (args?: unknown) => {
    calls.push(name)
    return Promise.resolve(typeof value === 'function' ? (value as (a: unknown) => T)(args) : value)
  }
}

const COLUMNS = [
  { statusId: 'status_open' as PostStatusId },
  { statusId: 'status_planned' as PostStatusId },
]
const ROADMAPS = [
  { id: 'roadmap_first', type: 'column', columns: COLUMNS },
  { id: 'roadmap_dates', type: 'date', columns: [] },
]
const page = (n: number) => ({ items: [{ id: `post_${n}` }], total: 1, hasMore: false })

// Server functions run in process, as the server runs the reads the loader batches.
vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal<typeof import('@tanstack/react-start')>())
})
vi.mock('@/lib/server/functions/roadmaps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/roadmaps')>()),
  fetchRoadmaps: stub('roadmaps', ROADMAPS),
  getRoadmapColumnsFn: stub('roadmapColumns', (args) =>
    (args as { data: { columns: unknown[] } }).data.columns.map((_, i) => page(i))
  ),
}))
vi.mock('@/lib/server/functions/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/admin')>()),
  fetchStatusesList: stub('statuses', []),
  fetchTagsList: stub('tags', []),
  listSegmentsFn: stub('segments', []),
}))
vi.mock('@/lib/server/functions/boards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/boards')>()),
  fetchBoardsFn: stub('boards', []),
}))

const { useRoadmaps } = await import('@/lib/client/hooks/use-roadmaps-query')
const { useRoadmapPostsByRoadmap } = await import('@/lib/client/hooks/use-roadmap-posts-query')

type Loader = (ctx: {
  context: Record<string, unknown>
  location: { search: Record<string, unknown> }
}) => Promise<unknown>
async function loaderOf(path: string): Promise<Loader> {
  const { Route } = await import(/* @vite-ignore */ path)
  return (Route as { options: { loader: Loader } }).options.loader
}

let client: QueryClient
beforeEach(() => {
  calls.length = 0
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Run a route's loader for a URL, then mount the page's reads and list what they fetched. */
async function fetchesAfterLoader(
  path: string,
  search: Record<string, unknown>,
  useReads: () => void
) {
  const loader = await loaderOf(path)
  await loader({
    context: {
      queryClient: client,
      user: { name: 'Ada', email: 'ada@example.com' },
      principal: { id: 'principal_1', role: 'admin' },
    },
    location: { search },
  })
  const warmed = [...calls].sort()
  calls.length = 0
  renderHook(useReads, { wrapper })
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return { warmed, afterMount: [...calls] }
}

describe('/admin/roadmap loader', () => {
  it('warms the first roadmap and its columns in one request', async () => {
    const { warmed, afterMount } = await fetchesAfterLoader('@/routes/admin/roadmap', {}, () => {
      useRoadmaps()
      for (const { statusId } of COLUMNS) {
        // The board's column reads, with the unfiltered board's filters.
        useRoadmapPostsByRoadmap({
          roadmapId: 'roadmap_first' as RoadmapId,
          statusId,
          filters: {
            search: undefined,
            board: undefined,
            tags: undefined,
            segmentIds: undefined,
            sort: undefined,
          },
        })
      }
    })
    expect(afterMount).toEqual([])
    expect(warmed).toEqual(
      ['boards', 'roadmapColumns', 'roadmaps', 'segments', 'statuses', 'tags'].sort()
    )
    const column = client.getQueryData([
      'roadmapPosts',
      'roadmap',
      'roadmap_first',
      'status_planned',
      {},
    ])
    expect(column).toEqual({ pages: [page(1)], pageParams: [0] })
  })

  it('leaves a filtered board and a date roadmap to the page', async () => {
    const loader = await loaderOf('@/routes/admin/roadmap')
    const context = {
      queryClient: client,
      user: { name: 'Ada', email: 'ada@example.com' },
      principal: { id: 'principal_1', role: 'admin' },
    }
    await loader({ context, location: { search: { search: 'dark mode' } } })
    await loader({ context, location: { search: { roadmap: 'roadmap_dates' } } })
    expect(calls).not.toContain('roadmapColumns')
  })
})
