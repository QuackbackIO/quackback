// @vitest-environment happy-dom
/**
 * The public roadmap page's shell (the roadmap list, and the statuses, boards
 * and tags its columns and filters read) costs one request when the loader
 * runs in the browser, and each list lands in the cache entry its component
 * reads, so none of them asks again on mount.
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

const roadmaps = [{ id: 'roadmap_1', name: 'Now, next, later' }]
const statuses = [{ id: 'status_1', name: 'Open' }]
const boards = [{ id: 'board_1', name: 'Feature requests' }]
const tags = [{ id: 'tag_1', name: 'bug' }]

// Server functions run in process, as the server runs the reads the loader batches.
vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal<typeof import('@tanstack/react-start')>())
})
vi.mock('@/lib/server/functions/portal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/portal')>()),
  fetchPublicRoadmaps: read('roadmaps', roadmaps),
  fetchPublicStatuses: read('statuses', statuses),
  fetchPublicBoards: read('boards', boards),
  fetchPublicTags: read('tags', tags),
}))
vi.mock('@/lib/server/functions/read-batch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/functions/read-batch')>()
  return { ...actual, readTogetherFn: vi.fn(actual.readTogetherFn) }
})

// The registry the batched reads run from pulls in every query module; paid
// here, at file load, rather than inside the first test's timed body.
await import('@/lib/server/read-registry')
const { Route } = await import('../_portal/roadmap.index')
const { portalQueries } = await import('@/lib/client/queries/portal')
const { readTogetherFn } = await import('@/lib/server/functions/read-batch')
const batches = vi.mocked(readTogetherFn)

type Loader = (ctx: { context: Record<string, unknown> }) => Promise<Record<string, unknown>>
const loader = (Route as unknown as { options: { loader: Loader } }).options.loader

const runLoader = (queryClient: QueryClient) =>
  loader({ context: { queryClient, settings: { name: 'Acme' }, baseUrl: '', userRole: null } })

beforeEach(() => {
  ran.length = 0
  batches.mockClear()
})

describe('public roadmap loader', () => {
  it('reads the shell in one request and fills the entry each component reads', async () => {
    const queryClient = new QueryClient()
    const data = await runLoader(queryClient)

    expect(data.firstRoadmapId).toBe('roadmap_1')
    expect(batches).toHaveBeenCalledTimes(1)
    // The server knows every read, so none is left to a request of its own.
    const answered = await batches.mock.results[0]!.value
    expect(answered.map((result: { ok: boolean }) => result.ok)).toEqual([true, true, true, true])
    expect(ran.sort()).toEqual(['boards', 'roadmaps', 'statuses', 'tags'])
    expect(queryClient.getQueryData(portalQueries.roadmaps().queryKey)).toEqual(roadmaps)
    expect(queryClient.getQueryData(portalQueries.statuses().queryKey)).toEqual(statuses)
    expect(queryClient.getQueryData(portalQueries.boards().queryKey)).toEqual(boards)
    expect(queryClient.getQueryData(portalQueries.tags().queryKey)).toEqual(tags)
  })

  it('asks only for the lists not already cached', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(portalQueries.statuses().queryKey, statuses as never)
    queryClient.setQueryData(portalQueries.tags().queryKey, tags as never)

    await runLoader(queryClient)

    expect(batches).toHaveBeenCalledTimes(1)
    expect(batches.mock.calls[0]![0]!.data.reads).toEqual([
      portalQueries.roadmaps().queryKey,
      portalQueries.boards().queryKey,
    ])
    expect(ran.sort()).toEqual(['boards', 'roadmaps'])
  })
})
