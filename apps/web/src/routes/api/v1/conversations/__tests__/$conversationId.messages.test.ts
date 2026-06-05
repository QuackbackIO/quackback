import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockAssert = vi.fn()
const mockListMessages = vi.fn()

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
  listMessages: (...a: unknown[]) => mockListMessages(...a),
}))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: vi.fn(async () => new Set()),
}))

import { Route } from '../$conversationId.messages'
type RouteOpts = {
  server: {
    handlers: {
      GET: (a: { request: Request; params: { conversationId: string } }) => Promise<Response>
    }
  }
}
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const CONV_ID = 'conversation_01h455vb4pex5vsknk084sn02q'
const msg = {
  id: 'chat_msg_1',
  conversationId: CONV_ID,
  senderType: 'visitor',
  content: 'hi',
  createdAt: '2026-06-05T00:00:00.000Z',
  author: { principalId: 'principal_v', displayName: 'Sam', avatarUrl: null },
  attachments: [],
  isInternal: false,
  contentJson: null,
  viaEmail: false,
  systemEvent: null,
}

beforeEach(() => {
  mockAuth.mockReset()
  mockAssert.mockReset()
  mockListMessages.mockReset()
  mockAuth.mockResolvedValue({ principalId: 'principal_key', role: 'admin', importMode: false })
  mockAssert.mockResolvedValue({ id: CONV_ID })
})

describe('GET /api/v1/conversations/:id/messages', () => {
  it('returns serialized messages, internal notes excluded by default', async () => {
    mockListMessages.mockResolvedValue({ messages: [msg], hasMore: false, nextCursor: null })
    const res = await GET({
      request: new Request('http://test'),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data[0]).toMatchObject({
      id: 'chat_msg_1',
      senderType: 'visitor',
      isInternal: false,
    })
    expect(mockListMessages).toHaveBeenCalledWith(
      CONV_ID,
      expect.objectContaining({ includeInternal: false })
    )
  })

  it('passes includeInternal=true through when requested', async () => {
    mockListMessages.mockResolvedValue({ messages: [], hasMore: false, nextCursor: null })
    await GET({
      request: new Request('http://test/?includeInternal=true'),
      params: { conversationId: CONV_ID },
    })
    expect(mockListMessages).toHaveBeenCalledWith(
      CONV_ID,
      expect.objectContaining({ includeInternal: true })
    )
  })
})
