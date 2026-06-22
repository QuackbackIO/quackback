/**
 * Request-level behaviour tests for the conversation *action* routes.
 *
 * Existing sibling tests already cover index / $conversationId / messages, so
 * this file is scoped to the action handlers only: assign, end, note, priority,
 * read, reply, status, and the tag attach / detach / list routes. The
 * `-chat-actor.ts` helper is not imported directly — it is exercised through the
 * routes that build an actor + author from the auth context (note, reply).
 *
 * Mirrors the canonical pattern in
 * apps/web/src/routes/api/v1/inboxes/__tests__/inboxes.test.ts: every external
 * dependency is hoisted into a vi.fn() mock, createFileRoute is stubbed to
 * surface the handler map, and the chat services (loaded lazily via dynamic
 * import inside each handler) are mocked at the module level.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  // chat.service
  assignConversationMock: vi.fn(),
  endConversationMock: vi.fn(),
  addAgentNoteMock: vi.fn(),
  setConversationPriorityMock: vi.fn(),
  markConversationReadMock: vi.fn(),
  sendAgentMessageMock: vi.fn(),
  setConversationStatusMock: vi.fn(),
  // chat-tag.service
  listTagsForConversationMock: vi.fn(),
  attachTagMock: vi.fn(),
  detachTagMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
  assertScopeAllowed: (...args: unknown[]) => hoisted.assertScopeAllowedMock(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => hoisted.loadPermissionSetMock(...args),
  hasPermission: (...args: unknown[]) => hoisted.hasPermissionMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

// The enum constants imported by the end / priority / status routes. Mirrors
// the real arrays in @quackback/db/types so zod schemas accept valid values.
vi.mock('@/lib/server/db', () => ({
  CONVERSATION_STATUSES: ['open', 'pending', 'closed'],
  CONVERSATION_END_REASONS: [
    'resolved',
    'tracked_as_feedback',
    'duplicate',
    'no_response',
    'spam',
    'other',
  ],
  CONVERSATION_PRIORITIES: ['none', 'low', 'medium', 'high', 'urgent'],
}))

// Both chat services are pulled in lazily via dynamic import() inside each
// handler; mocking them at module level intercepts those imports.
vi.mock('@/lib/server/domains/chat/chat.service', () => ({
  assignConversation: (...args: unknown[]) => hoisted.assignConversationMock(...args),
  endConversation: (...args: unknown[]) => hoisted.endConversationMock(...args),
  addAgentNote: (...args: unknown[]) => hoisted.addAgentNoteMock(...args),
  setConversationPriority: (...args: unknown[]) => hoisted.setConversationPriorityMock(...args),
  markConversationRead: (...args: unknown[]) => hoisted.markConversationReadMock(...args),
  sendAgentMessage: (...args: unknown[]) => hoisted.sendAgentMessageMock(...args),
  setConversationStatus: (...args: unknown[]) => hoisted.setConversationStatusMock(...args),
}))

vi.mock('@/lib/server/domains/chat/chat-tag.service', () => ({
  listTagsForConversation: (...args: unknown[]) => hoisted.listTagsForConversationMock(...args),
  attachTag: (...args: unknown[]) => hoisted.attachTagMock(...args),
  detachTag: (...args: unknown[]) => hoisted.detachTagMock(...args),
}))

import { Route as AssignRoute } from '../$conversationId.assign'
import { Route as EndRoute } from '../$conversationId.end'
import { Route as NoteRoute } from '../$conversationId.note'
import { Route as PriorityRoute } from '../$conversationId.priority'
import { Route as ReadRoute } from '../$conversationId.read'
import { Route as ReplyRoute } from '../$conversationId.reply'
import { Route as StatusRoute } from '../$conversationId.status'
import { Route as TagsRoute } from '../$conversationId.tags'
import { Route as TagDetailRoute } from '../$conversationId.tags.$chatTagId'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const assignHandlers = (AssignRoute as unknown as RouteWithHandlers).options.server.handlers
const endHandlers = (EndRoute as unknown as RouteWithHandlers).options.server.handlers
const noteHandlers = (NoteRoute as unknown as RouteWithHandlers).options.server.handlers
const priorityHandlers = (PriorityRoute as unknown as RouteWithHandlers).options.server.handlers
const readHandlers = (ReadRoute as unknown as RouteWithHandlers).options.server.handlers
const replyHandlers = (ReplyRoute as unknown as RouteWithHandlers).options.server.handlers
const statusHandlers = (StatusRoute as unknown as RouteWithHandlers).options.server.handlers
const tagsHandlers = (TagsRoute as unknown as RouteWithHandlers).options.server.handlers
const tagDetailHandlers = (TagDetailRoute as unknown as RouteWithHandlers).options.server.handlers

const PRINCIPAL = 'principal_agent'
const CONVERSATION = 'conversation_123'
const CHAT_TAG = 'chat_tag_123'
const KEY_NAME = 'CI key'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/conversations')
) {
  return { request, params: handlerParams }
}

async function expectJsonData(response: Response) {
  return (await response.json()).data
}

/**
 * A NotFoundError-shaped domain error: handleDomainError maps a `code` of
 * 'NOT_FOUND' (or any entry in its resource map) to a 404 response.
 */
function notFoundError() {
  return { code: 'NOT_FOUND', message: 'Conversation not found' }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'team',
    key: { scopes: [], name: KEY_NAME },
  })
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.hasPermissionMock.mockReturnValue(true)
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
})

describe('POST /api/v1/conversations/:id/assign', () => {
  it('assigns to an agent principal after the chat.manage checks', async () => {
    hoisted.assignConversationMock.mockResolvedValue({
      id: CONVERSATION,
      assignedAgentPrincipalId: 'principal_target',
    })

    const response = await assignHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/assign', 'POST', { agentPrincipalId: 'principal_target' })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({
      id: CONVERSATION,
      assignedAgentPrincipalId: 'principal_target',
    })
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_MANAGE
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(expect.any(Set), PERMISSIONS.CHAT_MANAGE)
    expect(hoisted.assignConversationMock).toHaveBeenCalledWith(
      CONVERSATION,
      'principal_target',
      expect.objectContaining({ principalId: PRINCIPAL, role: 'team', principalType: 'service' })
    )
  })

  it('coerces a null agentPrincipalId to null (unassign) via the ?? branch', async () => {
    hoisted.assignConversationMock.mockResolvedValue({
      id: CONVERSATION,
      assignedAgentPrincipalId: null,
    })

    const response = await assignHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/assign', 'POST', { agentPrincipalId: null })
      )
    )

    expect(response.status).toBe(200)
    expect(hoisted.assignConversationMock).toHaveBeenCalledWith(
      CONVERSATION,
      null,
      expect.any(Object)
    )
  })

  it('returns 403 when chat.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await assignHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/assign', 'POST', { agentPrincipalId: null })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.assignConversationMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid body (missing agentPrincipalId)', async () => {
    const response = await assignHandlers.POST(
      args({ conversationId: CONVERSATION }, jsonRequest('http://test/assign', 'POST', {}))
    )

    expect(response.status).toBe(400)
    expect(hoisted.assignConversationMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the JSON body cannot be parsed (null fallback)', async () => {
    const response = await assignHandlers.POST(
      args({ conversationId: CONVERSATION }, new Request('http://test/assign', { method: 'POST' }))
    )

    expect(response.status).toBe(400)
    expect(hoisted.assignConversationMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the service reports the conversation is missing', async () => {
    hoisted.assignConversationMock.mockRejectedValue(notFoundError())

    const response = await assignHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/assign', 'POST', { agentPrincipalId: null })
      )
    )

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/conversations/:id/end', () => {
  it('ends with a reason and forwards an optional note', async () => {
    hoisted.endConversationMock.mockResolvedValue({ id: CONVERSATION, status: 'closed' })

    const response = await endHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/end', 'POST', { reason: 'resolved', note: 'all sorted' })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({ id: CONVERSATION, status: 'closed' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_MANAGE
    )
    expect(hoisted.endConversationMock).toHaveBeenCalledWith(
      CONVERSATION,
      'resolved',
      'all sorted',
      expect.objectContaining({ principalId: PRINCIPAL })
    )
  })

  it('defaults a missing note to null via the ?? branch', async () => {
    hoisted.endConversationMock.mockResolvedValue({ id: CONVERSATION, status: 'closed' })

    const response = await endHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/end', 'POST', { reason: 'spam' })
      )
    )

    expect(response.status).toBe(200)
    expect(hoisted.endConversationMock).toHaveBeenCalledWith(
      CONVERSATION,
      'spam',
      null,
      expect.any(Object)
    )
  })

  it('returns 403 when chat.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await endHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/end', 'POST', { reason: 'resolved' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.endConversationMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid reason', async () => {
    const response = await endHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/end', 'POST', { reason: 'not-a-reason' })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.endConversationMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the conversation is missing', async () => {
    hoisted.endConversationMock.mockRejectedValue(notFoundError())

    const response = await endHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/end', 'POST', { reason: 'resolved' })
      )
    )

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/conversations/:id/note', () => {
  it('creates an internal note (201) and builds the agent author from the key', async () => {
    const createdAt = new Date('2026-06-05T00:00:00.000Z')
    hoisted.addAgentNoteMock.mockResolvedValue({
      message: { id: 'chat_msg_1', conversationId: CONVERSATION, createdAt },
    })

    const response = await noteHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/note', 'POST', { content: 'internal context' })
      )
    )

    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(
      JSON.parse(JSON.stringify({ id: 'chat_msg_1', conversationId: CONVERSATION, createdAt }))
    )
    expect(hoisted.addAgentNoteMock).toHaveBeenCalledWith(
      CONVERSATION,
      'internal context',
      expect.objectContaining({ principalId: PRINCIPAL, displayName: KEY_NAME }),
      expect.objectContaining({ principalId: PRINCIPAL, principalType: 'service' })
    )
  })

  it('returns 403 when chat.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await noteHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/note', 'POST', { content: 'x' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.addAgentNoteMock).not.toHaveBeenCalled()
  })

  it('returns 400 on empty content', async () => {
    const response = await noteHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/note', 'POST', { content: '' })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.addAgentNoteMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the conversation is missing', async () => {
    hoisted.addAgentNoteMock.mockRejectedValue(notFoundError())

    const response = await noteHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/note', 'POST', { content: 'note body' })
      )
    )

    expect(response.status).toBe(404)
  })
})

describe('PATCH /api/v1/conversations/:id/priority', () => {
  it('sets the priority after the chat.manage checks', async () => {
    hoisted.setConversationPriorityMock.mockResolvedValue({ id: CONVERSATION, priority: 'high' })

    const response = await priorityHandlers.PATCH(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/priority', 'PATCH', { priority: 'high' })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({ id: CONVERSATION, priority: 'high' })
    expect(hoisted.setConversationPriorityMock).toHaveBeenCalledWith(
      CONVERSATION,
      'high',
      expect.objectContaining({ principalId: PRINCIPAL })
    )
  })

  it('returns 403 when chat.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await priorityHandlers.PATCH(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/priority', 'PATCH', { priority: 'high' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.setConversationPriorityMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid priority', async () => {
    const response = await priorityHandlers.PATCH(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/priority', 'PATCH', { priority: 'super-urgent' })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.setConversationPriorityMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the conversation is missing', async () => {
    hoisted.setConversationPriorityMock.mockRejectedValue(notFoundError())

    const response = await priorityHandlers.PATCH(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/priority', 'PATCH', { priority: 'low' })
      )
    )

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/conversations/:id/read', () => {
  it('marks the conversation read and returns 204', async () => {
    hoisted.markConversationReadMock.mockResolvedValue(undefined)

    const response = await readHandlers.POST(args({ conversationId: CONVERSATION }))

    expect(response.status).toBe(204)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_MANAGE
    )
    expect(hoisted.markConversationReadMock).toHaveBeenCalledWith(
      CONVERSATION,
      expect.objectContaining({ principalId: PRINCIPAL, principalType: 'service' })
    )
  })

  it('returns 403 when chat.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await readHandlers.POST(args({ conversationId: CONVERSATION }))

    expect(response.status).toBe(403)
    expect(hoisted.markConversationReadMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the conversation is missing', async () => {
    hoisted.markConversationReadMock.mockRejectedValue(notFoundError())

    const response = await readHandlers.POST(args({ conversationId: CONVERSATION }))

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/conversations/:id/reply', () => {
  it('sends a public agent reply (201) including the resulting status', async () => {
    const createdAt = new Date('2026-06-05T00:00:00.000Z')
    hoisted.sendAgentMessageMock.mockResolvedValue({
      message: { id: 'chat_msg_2', conversationId: CONVERSATION, createdAt },
      conversation: { status: 'open' },
    })

    const response = await replyHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/reply', 'POST', { content: 'thanks for reaching out' })
      )
    )

    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(
      JSON.parse(
        JSON.stringify({
          id: 'chat_msg_2',
          conversationId: CONVERSATION,
          status: 'open',
          createdAt,
        })
      )
    )
    expect(hoisted.sendAgentMessageMock).toHaveBeenCalledWith(
      CONVERSATION,
      'thanks for reaching out',
      expect.objectContaining({ principalId: PRINCIPAL, displayName: KEY_NAME }),
      expect.objectContaining({ principalId: PRINCIPAL, principalType: 'service' })
    )
  })

  it('returns 403 when chat.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await replyHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/reply', 'POST', { content: 'hi' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.sendAgentMessageMock).not.toHaveBeenCalled()
  })

  it('returns 400 on empty content', async () => {
    const response = await replyHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/reply', 'POST', { content: '' })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.sendAgentMessageMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the conversation is missing', async () => {
    hoisted.sendAgentMessageMock.mockRejectedValue(notFoundError())

    const response = await replyHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/reply', 'POST', { content: 'body' })
      )
    )

    expect(response.status).toBe(404)
  })
})

describe('PATCH /api/v1/conversations/:id/status', () => {
  it('sets the status after the chat.manage checks', async () => {
    hoisted.setConversationStatusMock.mockResolvedValue({ id: CONVERSATION, status: 'pending' })

    const response = await statusHandlers.PATCH(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/status', 'PATCH', { status: 'pending' })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({ id: CONVERSATION, status: 'pending' })
    expect(hoisted.setConversationStatusMock).toHaveBeenCalledWith(
      CONVERSATION,
      'pending',
      expect.objectContaining({ principalId: PRINCIPAL })
    )
  })

  it('returns 403 when chat.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await statusHandlers.PATCH(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/status', 'PATCH', { status: 'closed' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.setConversationStatusMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid status', async () => {
    const response = await statusHandlers.PATCH(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/status', 'PATCH', { status: 'archived' })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.setConversationStatusMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the conversation is missing', async () => {
    hoisted.setConversationStatusMock.mockRejectedValue(notFoundError())

    const response = await statusHandlers.PATCH(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/status', 'PATCH', { status: 'open' })
      )
    )

    expect(response.status).toBe(404)
  })
})

describe('GET /api/v1/conversations/:id/tags', () => {
  it('lists the tags on a conversation after the chat.view check', async () => {
    const tags = [{ id: CHAT_TAG, name: 'billing' }]
    hoisted.listTagsForConversationMock.mockResolvedValue(tags)

    const response = await tagsHandlers.GET(args({ conversationId: CONVERSATION }))

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(tags)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_VIEW
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(expect.any(Set), PERMISSIONS.CHAT_VIEW)
    expect(hoisted.listTagsForConversationMock).toHaveBeenCalledWith(CONVERSATION)
  })

  it('returns 403 when chat.view permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await tagsHandlers.GET(args({ conversationId: CONVERSATION }))

    expect(response.status).toBe(403)
    expect(hoisted.listTagsForConversationMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the conversation is missing', async () => {
    hoisted.listTagsForConversationMock.mockRejectedValue(notFoundError())

    const response = await tagsHandlers.GET(args({ conversationId: CONVERSATION }))

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/conversations/:id/tags', () => {
  it('attaches a tag after parsing the chat tag id', async () => {
    const attached = { id: CHAT_TAG, conversationId: CONVERSATION }
    hoisted.attachTagMock.mockResolvedValue(attached)

    const response = await tagsHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/tags', 'POST', { chatTagId: CHAT_TAG })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(attached)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_MANAGE
    )
    // Both the conversation id and the chat tag id flow through parseTypeId.
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(CHAT_TAG, 'chat_tag', 'chat tag ID')
    expect(hoisted.attachTagMock).toHaveBeenCalledWith(CONVERSATION, CHAT_TAG)
  })

  it('returns 403 when chat.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await tagsHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/tags', 'POST', { chatTagId: CHAT_TAG })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.attachTagMock).not.toHaveBeenCalled()
  })

  it('returns 400 when chatTagId is missing', async () => {
    const response = await tagsHandlers.POST(
      args({ conversationId: CONVERSATION }, jsonRequest('http://test/tags', 'POST', {}))
    )

    expect(response.status).toBe(400)
    expect(hoisted.attachTagMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the conversation or tag is missing', async () => {
    hoisted.attachTagMock.mockRejectedValue(notFoundError())

    const response = await tagsHandlers.POST(
      args(
        { conversationId: CONVERSATION },
        jsonRequest('http://test/tags', 'POST', { chatTagId: CHAT_TAG })
      )
    )

    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/v1/conversations/:id/tags/:chatTagId', () => {
  it('detaches a tag after parsing both ids', async () => {
    const result = { detached: true }
    hoisted.detachTagMock.mockResolvedValue(result)

    const response = await tagDetailHandlers.DELETE(
      args({ conversationId: CONVERSATION, chatTagId: CHAT_TAG })
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(result)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_MANAGE
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(CHAT_TAG, 'chat_tag', 'chat tag ID')
    expect(hoisted.detachTagMock).toHaveBeenCalledWith(CONVERSATION, CHAT_TAG)
  })

  it('returns 403 when chat.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await tagDetailHandlers.DELETE(
      args({ conversationId: CONVERSATION, chatTagId: CHAT_TAG })
    )

    expect(response.status).toBe(403)
    expect(hoisted.detachTagMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the tag is missing', async () => {
    hoisted.detachTagMock.mockRejectedValue(notFoundError())

    const response = await tagDetailHandlers.DELETE(
      args({ conversationId: CONVERSATION, chatTagId: CHAT_TAG })
    )

    expect(response.status).toBe(404)
  })
})
