import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockList = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/chat/chat.query', () => ({
  listConversationsForAgent: (...a: unknown[]) => mockList(...a),
}))

import { Route } from '../index'
type RouteOpts = { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const dto = {
  id: 'conversation_1',
  status: 'open',
  priority: 'none',
  channel: 'live_chat',
  subject: 'Hi',
  lastMessagePreview: 'Hi',
  lastMessageAt: '2026-06-05T00:00:00.000Z',
  createdAt: '2026-06-05T00:00:00.000Z',
  visitor: { principalId: 'principal_v', displayName: 'Sam', avatarUrl: null },
  assignedAgent: null,
  unreadCount: 0,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  visitorEmail: null,
  resolvedAt: null,
  tags: [],
}

beforeEach(() => {
  mockAuth.mockReset()
  mockList.mockReset()
  mockAuth.mockResolvedValue({ principalId: 'principal_key', role: 'admin', importMode: false })
})

describe('GET /api/v1/conversations', () => {
  it('returns serialized conversations with pagination meta', async () => {
    mockList.mockResolvedValue({
      conversations: [dto],
      hasMore: true,
      nextCursor: 'conversation_1',
    })
    const res = await GET({
      request: new Request('http://test/api/v1/conversations?status=open&limit=10'),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: 'conversation_1',
      status: 'open',
      visitorPrincipalId: 'principal_v',
    })
    expect(body.meta.pagination).toEqual({ cursor: 'conversation_1', hasMore: true })
    // status + limit forwarded to the query
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ status: 'open', limit: 10 }))
  })

  it('rejects a non-team key (403 from withApiKeyAuth)', async () => {
    const { ForbiddenError } = await import('@/lib/shared/errors')
    mockAuth.mockRejectedValue(new ForbiddenError('FORBIDDEN', 'Team member access required'))
    const res = await GET({ request: new Request('http://test/api/v1/conversations') })
    expect(res.status).toBe(403)
  })
})
