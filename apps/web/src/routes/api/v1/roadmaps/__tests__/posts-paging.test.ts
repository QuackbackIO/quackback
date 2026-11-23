/**
 * GET /api/v1/roadmaps/:roadmapId/posts takes limit and offset from the query.
 * A negative offset used to reach SQL (a 500) and limit=0 answered an empty
 * page claiming hasMore; both, and any non-integer, are a 400 before the
 * query runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateId } from '@quackback/ids'

const { mockGetRoadmapPosts } = vi.hoisted(() => ({ mockGetRoadmapPosts: vi.fn() }))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn().mockResolvedValue({ principalId: 'principal_test', role: 'admin' }),
}))
vi.mock('@/lib/server/domains/roadmaps/roadmap.query', () => ({
  getRoadmapPosts: (...args: unknown[]) => mockGetRoadmapPosts(...args),
}))

import { Route } from '../$roadmapId.posts'

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>

const roadmapId = generateId('roadmap')

function get(query: string) {
  const handler = (Route.options as unknown as { server: { handlers: { GET: Handler } } }).server
    .handlers.GET
  return handler({
    request: new Request(`http://test/api/v1/roadmaps/${roadmapId}/posts?${query}`),
    params: { roadmapId },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetRoadmapPosts.mockResolvedValue({ items: [], total: 0, hasMore: false })
})

describe('GET /api/v1/roadmaps/:roadmapId/posts paging', () => {
  it.each(['offset=-1', 'limit=0', 'limit=-5', 'limit=abc', 'offset=1.5'])(
    '%s is a 400',
    async (query) => {
      const res = await get(query)

      expect(res.status).toBe(400)
      expect(mockGetRoadmapPosts).not.toHaveBeenCalled()
    }
  )

  it('passes valid paging through, capping limit at 100', async () => {
    expect((await get('limit=500&offset=3')).status).toBe(200)
    expect(mockGetRoadmapPosts).toHaveBeenCalledWith(
      roadmapId,
      expect.objectContaining({ limit: 100, offset: 3 })
    )
  })

  it('defaults to 20 from 0', async () => {
    expect((await get('')).status).toBe(200)
    expect(mockGetRoadmapPosts).toHaveBeenCalledWith(
      roadmapId,
      expect.objectContaining({ limit: 20, offset: 0 })
    )
  })
})
