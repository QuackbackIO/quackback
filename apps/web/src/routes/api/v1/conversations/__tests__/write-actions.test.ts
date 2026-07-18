import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockSendAgentMessage = vi.fn()
const mockAddAgentNote = vi.fn()
const mockSetStatus = vi.fn()
const mockAssign = vi.fn()
const mockSetPriority = vi.fn()
const mockMarkRead = vi.fn()
const mockAssertViewable = vi.fn()
const mockConversationToDTO = vi.fn()
const mockAttachTag = vi.fn()
const mockDetachTag = vi.fn()

// Records call ordering across the tag route to prove the viewable assert runs first.
const order: string[] = []

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  sendAgentMessage: (...a: unknown[]) => mockSendAgentMessage(...a),
  addAgentNote: (...a: unknown[]) => mockAddAgentNote(...a),
  setConversationStatus: (...a: unknown[]) => mockSetStatus(...a),
  assignConversation: (...a: unknown[]) => mockAssign(...a),
  setConversationPriority: (...a: unknown[]) => mockSetPriority(...a),
  markConversationRead: (...a: unknown[]) => mockMarkRead(...a),
  assertConversationViewable: (...a: unknown[]) => {
    order.push('assertViewable')
    return mockAssertViewable(...a)
  },
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  conversationToDTO: (...a: unknown[]) => mockConversationToDTO(...a),
}))
vi.mock('@/lib/server/domains/conversation/conversation-tag.service', () => ({
  attachTag: (...a: unknown[]) => {
    order.push('attachTag')
    return mockAttachTag(...a)
  },
  detachTag: (...a: unknown[]) => {
    order.push('detachTag')
    return mockDetachTag(...a)
  },
}))
vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: (md: string) => ({ doc: md }),
}))
vi.mock('@/lib/server/sanitize-tiptap', () => ({
  sanitizeTiptapContent: (json: unknown) => json,
}))

import { Route as ReplyRoute } from '../$conversationId.reply'
import { Route as NoteRoute } from '../$conversationId.note'
import { Route as StatusRoute } from '../$conversationId.status'
import { Route as AssignRoute } from '../$conversationId.assign'
import { Route as PriorityRoute } from '../$conversationId.priority'
import { Route as ReadRoute } from '../$conversationId.read'
import { Route as TagsRoute } from '../$conversationId.tags'

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>
const handler = (route: unknown, method: 'POST' | 'DELETE'): Handler =>
  (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers[
    method
  ]

const CONV_ID = 'conversation_01h455vb4pex5vsknk084sn02q'
const PRINCIPAL_ID = 'principal_01h455vb4pex5vsknk084sn02q'
const TAG_ID = 'conversation_tag_01h455vb4pex5vsknk084sn02q'
const MSG_ID = 'conversation_msg_01h455vb4pex5vsknk084sn02q'

const convDTO = {
  id: CONV_ID,
  status: 'open',
  channel: 'messenger',
  priority: 'none',
  subject: null,
  visitor: { principalId: PRINCIPAL_ID },
  visitorEmail: 'v@x',
  assignedAgent: null,
  lastMessageAt: '2026-07-04T00:00:00.000Z',
  resolvedAt: null,
  createdAt: '2026-07-04T00:00:00.000Z',
}

const messageDTO = {
  id: MSG_ID,
  conversationId: CONV_ID,
  senderType: 'agent',
  isInternal: false,
  author: { principalId: PRINCIPAL_ID, displayName: 'Grace' },
  content: 'Hi there',
  createdAt: '2026-07-04T00:01:00.000Z',
}

const jsonReq = (url: string, body: unknown, method = 'POST') =>
  new Request(url, { method, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  mockAuth.mockResolvedValue({
    principalId: 'principal_key',
    role: 'admin',
    principal: { displayName: 'Key', user: { email: 'k@x' } },
    apiKey: { id: 'api_key_1', scopes: null },
  })
  mockConversationToDTO.mockResolvedValue(convDTO)
})

describe('POST /conversations/:id/reply', () => {
  it('gates conversation.reply and passes args in send order (attachments then contentJson)', async () => {
    mockSendAgentMessage.mockResolvedValue({ conversation: convDTO, message: messageDTO })
    const res = await handler(
      ReplyRoute,
      'POST'
    )({
      request: jsonReq(`https://x.test/api/v1/conversations/${CONV_ID}/reply`, {
        content: 'Hi there',
        attachments: [{ url: 'https://cdn/x.png', size: 10 }],
      }),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data).toMatchObject({ id: MSG_ID, content: 'Hi there' })
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'conversation.reply' })
    // sendAgentMessage(conversationId, rawContent, agent, actor, rawAttachments, contentJson)
    const args = mockSendAgentMessage.mock.calls[0]
    expect(args[0]).toBe(CONV_ID)
    expect(args[1]).toBe('Hi there')
    expect(args[2]).toMatchObject({ principalId: 'principal_key' })
    expect(args[3].principalType).toBe('service')
    expect(args[4]).toEqual([{ url: 'https://cdn/x.png', size: 10 }]) // attachments at index 4
    expect(args[5]).toEqual({ doc: 'Hi there' }) // contentJson at index 5
  })
})

describe('POST /conversations/:id/note', () => {
  it('gates conversation.note and passes args in note order (contentJson then attachments)', async () => {
    mockAddAgentNote.mockResolvedValue({ conversation: convDTO, message: messageDTO })
    const res = await handler(
      NoteRoute,
      'POST'
    )({
      request: jsonReq(`https://x.test/api/v1/conversations/${CONV_ID}/note`, {
        content: 'internal',
        attachments: [{ url: 'https://cdn/y.png', size: 20 }],
      }),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(201)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'conversation.note' })
    // addAgentNote(conversationId, rawContent, agent, actor, contentJson, attachments) — OPPOSITE order
    const args = mockAddAgentNote.mock.calls[0]
    expect(args[0]).toBe(CONV_ID)
    expect(args[1]).toBe('internal')
    expect(args[3].principalType).toBe('service')
    expect(args[4]).toEqual({ doc: 'internal' }) // contentJson at index 4
    expect(args[5]).toEqual([{ url: 'https://cdn/y.png', size: 20 }]) // attachments at index 5
  })
})

describe('POST /conversations/:id/status', () => {
  it('gates conversation.set_status and serializes the updated conversation', async () => {
    mockSetStatus.mockResolvedValue({ id: CONV_ID })
    const res = await handler(
      StatusRoute,
      'POST'
    )({
      request: jsonReq(`https://x.test/api/v1/conversations/${CONV_ID}/status`, {
        status: 'closed',
      }),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), {
      permission: 'conversation.set_status',
    })
    expect(mockSetStatus).toHaveBeenCalledWith(CONV_ID, 'closed', expect.anything())
    expect(mockConversationToDTO).toHaveBeenCalledWith({ id: CONV_ID }, 'agent')
    const body = await res.json()
    expect(body.data).toMatchObject({ id: CONV_ID, status: 'open' })
  })

  it('400s an invalid status', async () => {
    const res = await handler(
      StatusRoute,
      'POST'
    )({
      request: jsonReq(`https://x.test/api/v1/conversations/${CONV_ID}/status`, { status: 'nope' }),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(400)
    expect(mockSetStatus).not.toHaveBeenCalled()
  })
})

describe('POST /conversations/:id/assign', () => {
  it('unassigns on explicit null', async () => {
    mockAssign.mockResolvedValue({ id: CONV_ID })
    await handler(
      AssignRoute,
      'POST'
    )({
      request: jsonReq(`https://x.test/api/v1/conversations/${CONV_ID}/assign`, {
        assigneePrincipalId: null,
      }),
      params: { conversationId: CONV_ID },
    })
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'conversation.assign' })
    expect(mockAssign).toHaveBeenCalledWith(CONV_ID, null, expect.anything())
  })

  it('parses a concrete assignee principal id', async () => {
    mockAssign.mockResolvedValue({ id: CONV_ID })
    await handler(
      AssignRoute,
      'POST'
    )({
      request: jsonReq(`https://x.test/api/v1/conversations/${CONV_ID}/assign`, {
        assigneePrincipalId: PRINCIPAL_ID,
      }),
      params: { conversationId: CONV_ID },
    })
    expect(mockAssign).toHaveBeenCalledWith(CONV_ID, PRINCIPAL_ID, expect.anything())
  })
})

describe('POST /conversations/:id/priority', () => {
  it('gates conversation.set_status', async () => {
    mockSetPriority.mockResolvedValue({ id: CONV_ID })
    const res = await handler(
      PriorityRoute,
      'POST'
    )({
      request: jsonReq(`https://x.test/api/v1/conversations/${CONV_ID}/priority`, {
        priority: 'high',
      }),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), {
      permission: 'conversation.set_status',
    })
    expect(mockSetPriority).toHaveBeenCalledWith(CONV_ID, 'high', expect.anything())
  })
})

describe('POST /conversations/:id/read', () => {
  it('gates conversation.set_status (D10) and returns ok', async () => {
    mockMarkRead.mockResolvedValue(undefined)
    const res = await handler(
      ReadRoute,
      'POST'
    )({
      request: new Request(`https://x.test/api/v1/conversations/${CONV_ID}/read`, {
        method: 'POST',
      }),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), {
      permission: 'conversation.set_status',
    })
    expect(mockMarkRead).toHaveBeenCalledWith(CONV_ID, expect.anything())
    expect((await res.json()).data).toEqual({ ok: true })
  })
})

describe('POST/DELETE /conversations/:id/tags', () => {
  it('POST attaches a tag after asserting the conversation is viewable', async () => {
    mockAssertViewable.mockResolvedValue({ id: CONV_ID })
    mockAttachTag.mockResolvedValue([{ id: TAG_ID, name: 'billing', color: '#000' }])
    const res = await handler(
      TagsRoute,
      'POST'
    )({
      request: jsonReq(`https://x.test/api/v1/conversations/${CONV_ID}/tags`, { tagId: TAG_ID }),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), {
      permission: 'conversation.set_tags',
    })
    expect(mockAssertViewable).toHaveBeenCalledWith(CONV_ID, expect.anything())
    expect(mockAttachTag).toHaveBeenCalledWith(CONV_ID, TAG_ID)
    // The viewable assert MUST run before the ungated tag write.
    expect(order).toEqual(['assertViewable', 'attachTag'])
  })

  it('DELETE detaches a tag after asserting the conversation is viewable', async () => {
    mockAssertViewable.mockResolvedValue({ id: CONV_ID })
    mockDetachTag.mockResolvedValue([])
    const res = await handler(
      TagsRoute,
      'DELETE'
    )({
      request: jsonReq(
        `https://x.test/api/v1/conversations/${CONV_ID}/tags`,
        { tagId: TAG_ID },
        'DELETE'
      ),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(200)
    expect(order).toEqual(['assertViewable', 'detachTag'])
  })

  it('400s a malformed tag id without asserting or attaching', async () => {
    const res = await handler(
      TagsRoute,
      'POST'
    )({
      request: jsonReq(`https://x.test/api/v1/conversations/${CONV_ID}/tags`, { tagId: 'nope' }),
      params: { conversationId: CONV_ID },
    })
    expect(res.status).toBe(400)
    expect(mockAssertViewable).not.toHaveBeenCalled()
    expect(mockAttachTag).not.toHaveBeenCalled()
  })
})
