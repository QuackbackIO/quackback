/**
 * Differential-coverage tests for GET /api/widget/search — empty-query short
 * circuit, board-filter rejection, anonymous vs identified actor, and the
 * board/status post filtering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  listPublicPosts: vi.fn(),
  getWidgetSession: vi.fn(),
  segmentIdsForPrincipal: vi.fn(),
  getWidgetRequestContext: vi.fn(),
}))
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: (...a: unknown[]) => m.listPublicPosts(...a),
}))
vi.mock('@/lib/server/functions/widget-auth', () => ({
  getWidgetSession: (...a: unknown[]) => m.getWidgetSession(...a),
}))
vi.mock('@/lib/server/policy', () => ({
  ANONYMOUS_ACTOR: {
    principalId: null,
    role: null,
    principalType: 'anonymous',
    segmentIds: new Set(),
  },
}))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: (...a: unknown[]) => m.segmentIdsForPrincipal(...a),
}))
vi.mock('@/lib/server/widget/context', () => ({
  getWidgetRequestContext: (...a: unknown[]) => m.getWidgetRequestContext(...a),
}))
vi.mock('@/lib/server/widget/cors', () => ({
  mapDomainErrorToResponse: () => null,
  widgetCorsHeaders: () => new Headers(),
}))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ error: vi.fn() }) } }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
}))

import { Route } from '../search'

type RouteShape = {
  options: { server: { handlers: { GET: (c: { request: Request }) => Promise<Response> } } }
}
const GET = (Route as unknown as RouteShape).options.server.handlers.GET
const req = (qs: string) => new Request(`https://x.test/api/widget/search${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  m.getWidgetRequestContext.mockResolvedValue({ contentFilters: { feedback: {} } })
  m.getWidgetSession.mockResolvedValue(null)
  m.segmentIdsForPrincipal.mockResolvedValue(new Set())
  m.listPublicPosts.mockResolvedValue({
    items: [
      { id: 'p1', title: 'T', voteCount: 1, statusId: 'st1', board: { id: 'b1', slug: 'bugs' } },
    ],
  })
})

describe('widget search GET', () => {
  it('returns empty for a blank query', async () => {
    expect((await (await GET({ request: req('?q=%20') })).json()).data.posts).toEqual([])
  })
  it('rejects a board outside the allowed slugs', async () => {
    m.getWidgetRequestContext.mockResolvedValueOnce({
      contentFilters: { feedback: { boardSlugs: ['other'] } },
    })
    const res = await GET({ request: req('?q=hi&board=bugs') })
    expect((await res.json()).data.posts).toEqual([])
  })
  it('searches as an identified actor and filters posts', async () => {
    m.getWidgetSession.mockResolvedValueOnce({
      principal: { id: 'p1', role: 'user', type: 'user' },
    })
    m.segmentIdsForPrincipal.mockResolvedValueOnce(new Set(['s1']))
    const res = await GET({ request: req('?q=hi&limit=999') })
    expect((await res.json()).data.posts).toHaveLength(1)
    expect(m.listPublicPosts).toHaveBeenCalled()
  })
  it('searches anonymously and drops posts failing board/status filters', async () => {
    m.getWidgetRequestContext.mockResolvedValueOnce({
      contentFilters: { feedback: { boardIds: ['other'], statusIds: ['done'] } },
    })
    const res = await GET({ request: req('?q=hi') })
    expect((await res.json()).data.posts).toEqual([])
  })
})
