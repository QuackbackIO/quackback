import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockAssert = vi.fn()
const mockToDTO = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/chat/chat.service', () => ({
  assertConversationViewable: (...a: unknown[]) => mockAssert(...a),
}))
vi.mock('@/lib/server/domains/chat/chat.query', () => ({
  conversationToDTO: (...a: unknown[]) => mockToDTO(...a),
}))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: vi.fn(async () => new Set()),
}))

import { Route } from '../$conversationId'
type RouteOpts = {
  server: {
    handlers: {
      GET: (a: { request: Request; params: { conversationId: string } }) => Promise<Response>
    }
  }
}
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const CONV_ID = 'conversation_01h455vb4pex5vsknk084sn02q'

beforeEach(() => {
  mockAuth.mockReset()
  mockAssert.mockReset()
  mockToDTO.mockReset()
  mockAuth.mockResolvedValue({ principalId: 'principal_key', role: 'admin', importMode: false })
})

describe('GET /api/v1/conversations/:id', () => {
  it('returns the serialized conversation', async () => {
    mockAssert.mockResolvedValue({ id: CONV_ID }) // raw row; conversationToDTO is mocked
    mockToDTO.mockResolvedValue({
      id: CONV_ID,
      status: 'open',
      priority: 'none',
      channel: 'live_chat',
      subject: null,
      lastMessageAt: '2026-06-05T00:00:00.000Z',
      createdAt: '2026-06-05T00:00:00.000Z',
      visitor: { principalId: 'principal_v', displayName: null, avatarUrl: null },
      assignedAgent: null,
      unreadCount: 0,
      visitorLastReadAt: null,
      agentLastReadAt: null,
      csatRating: null,
      visitorEmail: null,
      resolvedAt: null,
      tags: [],
    })
    const res = await GET({
      request: new Request('http://test'),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({
      id: CONV_ID,
      status: 'open',
      visitorPrincipalId: 'principal_v',
    })
  })

  it('404s when the conversation is not viewable', async () => {
    const { NotFoundError } = await import('@/lib/shared/errors')
    mockAssert.mockRejectedValue(
      new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    )
    const res = await GET({
      request: new Request('http://test'),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(404)
  })

  it('400s on a malformed id', async () => {
    const res = await GET({
      request: new Request('http://test'),
      params: { conversationId: 'not-a-typeid' },
    })
    expect(res.status).toBe(400)
  })
})
