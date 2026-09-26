// @vitest-environment happy-dom
/**
 * The admin roadmap's lists (statuses, boards, tags and segments, which its
 * columns, filters and cards read) cost one request when the loader runs in
 * the browser, and each list lands in the cache entry its component reads.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ran } = vi.hoisted(() => ({ ran: [] as string[] }))

function read<T>(name: string, value: T) {
  return vi.fn(async () => {
    ran.push(name)
    return structuredClone(value)
  })
}

const statuses = [{ id: 'status_1', name: 'Open' }]
const boards = [{ id: 'board_1', name: 'Feature requests' }]
const tags = [{ id: 'tag_1', name: 'bug' }]
const segments = [{ id: 'segment_1', name: 'Enterprise' }]

// Server functions run in process, as the server runs the reads the loader batches.
vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal<typeof import('@tanstack/react-start')>())
})
vi.mock('@/lib/server/functions/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/admin')>()),
  fetchStatusesList: read('statuses', statuses),
  fetchTagsList: read('tags', tags),
  listSegmentsFn: read('segments', segments),
}))
vi.mock('@/lib/server/functions/boards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/boards')>()),
  fetchBoardsFn: read('boards', boards),
}))
// No roadmaps, so the loader has no board of columns to warm.
vi.mock('@/lib/server/functions/roadmaps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/roadmaps')>()),
  fetchRoadmaps: vi.fn(async () => []),
}))
vi.mock('@/lib/server/functions/read-batch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/functions/read-batch')>()
  return { ...actual, readTogetherFn: vi.fn(actual.readTogetherFn) }
})

// The registry the batched reads run from pulls in every query module; paid
// here, at file load, rather than inside the first test's timed body.
await import('@/lib/server/read-registry')
const { Route } = await import('../admin/roadmap')
const { adminQueries } = await import('@/lib/client/queries/admin')
const { readTogetherFn } = await import('@/lib/server/functions/read-batch')
const batches = vi.mocked(readTogetherFn)

type Loader = (ctx: {
  context: Record<string, unknown>
  location: { search: Record<string, unknown> }
}) => Promise<Record<string, unknown>>
const loader = (Route as unknown as { options: { loader: Loader } }).options.loader

const runLoader = (queryClient: QueryClient) =>
  loader({
    context: {
      queryClient,
      user: { name: 'Ada', email: 'ada@example.com' },
      principal: { id: 'principal_1' },
    },
    location: { search: {} },
  })

beforeEach(() => {
  ran.length = 0
  batches.mockClear()
})

describe('admin roadmap loader', () => {
  it('reads the lists in one request and fills the entry each component reads', async () => {
    const queryClient = new QueryClient()
    await runLoader(queryClient)

    expect(batches).toHaveBeenCalledTimes(1)
    // The server knows every read, so none is left to a request of its own.
    const answered = await batches.mock.results[0]!.value
    expect(answered.map((result: { ok: boolean }) => result.ok)).toEqual([true, true, true, true])
    expect(ran.sort()).toEqual(['boards', 'segments', 'statuses', 'tags'])
    expect(queryClient.getQueryData(adminQueries.statuses().queryKey)).toEqual(statuses)
    expect(queryClient.getQueryData(adminQueries.boards().queryKey)).toEqual(boards)
    expect(queryClient.getQueryData(adminQueries.tags().queryKey)).toEqual(tags)
    expect(queryClient.getQueryData(adminQueries.segments().queryKey)).toEqual(segments)
  })

  it('asks only for the lists not already cached', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(adminQueries.boards().queryKey, boards as never)
    queryClient.setQueryData(adminQueries.tags().queryKey, tags as never)

    await runLoader(queryClient)

    expect(batches).toHaveBeenCalledTimes(1)
    expect(batches.mock.calls[0]![0]!.data.reads).toEqual([
      adminQueries.statuses().queryKey,
      adminQueries.segments().queryKey,
    ])
    expect(ran.sort()).toEqual(['segments', 'statuses'])
  })
})
