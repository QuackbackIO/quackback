/**
 * `isPublic` is the deprecated spelling of roadmap visibility. A client that
 * still sends `{ isPublic: false }` must get a team-only roadmap rather than
 * the public default; `visibility` wins when both are sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateId } from '@quackback/ids'

const mockCreateRoadmap = vi.fn()
const mockUpdateRoadmap = vi.fn()

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn().mockResolvedValue({ principalId: 'principal_test', role: 'admin' }),
}))
vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({
  createRoadmap: (...args: unknown[]) => mockCreateRoadmap(...args),
  updateRoadmap: (...args: unknown[]) => mockUpdateRoadmap(...args),
}))

const ROADMAP = {
  id: 'roadmap_test',
  name: 'Roadmap',
  slug: 'roadmap',
  description: null,
  type: 'column',
  baseFilter: {},
  dateSource: null,
  frequency: null,
  visibility: 'team',
  visibleSegmentIds: null,
  position: 0,
  columns: [],
  createdAt: new Date(0),
}

type Handler = (ctx: { request: Request; params?: Record<string, string> }) => Promise<Response>

function handlerOf(mod: { Route: { options: unknown } }, method: 'POST' | 'PATCH'): Handler {
  return (mod.Route.options as { server: { handlers: Record<string, Handler> } }).server.handlers[
    method
  ]
}

function jsonRequest(method: string, body: unknown) {
  return new Request('http://test/api/v1/roadmaps', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateRoadmap.mockResolvedValue(ROADMAP)
  mockUpdateRoadmap.mockResolvedValue(ROADMAP)
})

describe('POST /api/v1/roadmaps isPublic alias', () => {
  async function create(body: Record<string, unknown>) {
    const post = handlerOf(await import('../index'), 'POST')
    const res = await post({ request: jsonRequest('POST', { name: 'R', slug: 'r', ...body }) })
    expect(res.status).toBe(201)
    return mockCreateRoadmap.mock.calls[0][0]
  }

  it('maps isPublic: false to team visibility', async () => {
    const input = await create({ isPublic: false })
    expect(input.visibility).toBe('team')
    expect(input).not.toHaveProperty('isPublic')
  })

  it('maps isPublic: true to public visibility', async () => {
    expect((await create({ isPublic: true })).visibility).toBe('public')
  })

  it('lets visibility win over isPublic', async () => {
    expect((await create({ isPublic: false, visibility: 'public' })).visibility).toBe('public')
  })

  it('leaves visibility unset when neither is sent', async () => {
    expect((await create({})).visibility).toBeUndefined()
  })
})

describe('PATCH /api/v1/roadmaps/:roadmapId isPublic alias', () => {
  it('maps isPublic: false to team visibility', async () => {
    const patch = handlerOf(await import('../$roadmapId'), 'PATCH')
    const res = await patch({
      request: jsonRequest('PATCH', { isPublic: false }),
      params: { roadmapId: generateId('roadmap') },
    })
    expect(res.status).toBe(200)
    expect(mockUpdateRoadmap.mock.calls[0][1].visibility).toBe('team')
  })
})
