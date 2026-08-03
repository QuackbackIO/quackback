import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listChatTagsWithCountsMock: vi.fn(),
  createChatTagMock: vi.fn(),
  updateChatTagMock: vi.fn(),
  deleteChatTagMock: vi.fn(),
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

// The route lazily imports the chat-tag service via dynamic import, so the
// module mock must expose the same named exports the handlers reach for.
vi.mock('@/lib/server/domains/chat/chat-tag.service', () => ({
  listChatTagsWithCounts: (...args: unknown[]) => hoisted.listChatTagsWithCountsMock(...args),
  createChatTag: (...args: unknown[]) => hoisted.createChatTagMock(...args),
  updateChatTag: (...args: unknown[]) => hoisted.updateChatTagMock(...args),
  deleteChatTag: (...args: unknown[]) => hoisted.deleteChatTagMock(...args),
}))

import { Route as TagsRoute } from '../index'
import { Route as TagDetailRoute } from '../$tagId'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const tagHandlers = (TagsRoute as unknown as RouteWithHandlers).options.server.handlers
const tagDetailHandlers = (TagDetailRoute as unknown as RouteWithHandlers).options.server.handlers

const PRINCIPAL = 'principal_admin'
const TAG = 'chat_tag_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/chat-tags')
) {
  return { request, params: handlerParams }
}

function tag(overrides: Record<string, unknown> = {}) {
  return {
    id: TAG,
    name: 'Urgent',
    color: '#FF0000',
    count: 3,
    ...overrides,
  }
}

async function expectJsonData(response: Response) {
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'team',
    key: { scopes: [] },
  })
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.hasPermissionMock.mockReturnValue(true)
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
})

describe('/api/v1/chat-tags routes', () => {
  it('lists conversation tags with usage counts after scope and permission checks', async () => {
    const row = tag()
    hoisted.listChatTagsWithCountsMock.mockResolvedValue([row])

    const response = await tagHandlers.GET(args())
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual([row])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_VIEW
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(expect.any(Set), PERMISSIONS.CHAT_VIEW)
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.listChatTagsWithCountsMock).toHaveBeenCalledWith()
  })

  it('creates a conversation tag with the optional colour supplied', async () => {
    const row = tag()
    hoisted.createChatTagMock.mockResolvedValue(row)

    const response = await tagHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/chat-tags', 'POST', {
          name: 'Urgent',
          color: '#FF0000',
        })
      )
    )
    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_MANAGE
    )
    expect(hoisted.createChatTagMock).toHaveBeenCalledWith({ name: 'Urgent', color: '#FF0000' })
  })

  it('creates a conversation tag when the optional colour is omitted', async () => {
    const row = tag({ color: null })
    hoisted.createChatTagMock.mockResolvedValue(row)

    const response = await tagHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/chat-tags', 'POST', { name: 'Backlog' }))
    )
    expect(response.status).toBe(201)
    expect(hoisted.createChatTagMock).toHaveBeenCalledWith({ name: 'Backlog' })
  })

  it('renames and recolours a conversation tag after parsing the id', async () => {
    const row = tag({ name: 'Renamed', color: '#00FF00' })
    hoisted.updateChatTagMock.mockResolvedValue(row)

    const response = await tagDetailHandlers.PATCH(
      args(
        { tagId: TAG },
        jsonRequest('http://test/api/v1/chat-tags/chat_tag_123', 'PATCH', {
          name: 'Renamed',
          color: '#00FF00',
        })
      )
    )
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_MANAGE
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TAG, 'chat_tag', 'chat tag ID')
    expect(hoisted.updateChatTagMock).toHaveBeenCalledWith(TAG, {
      name: 'Renamed',
      color: '#00FF00',
    })
  })

  it('accepts a PATCH with an empty object body (all fields optional)', async () => {
    const row = tag()
    hoisted.updateChatTagMock.mockResolvedValue(row)

    const response = await tagDetailHandlers.PATCH(
      args({ tagId: TAG }, jsonRequest('http://test/api/v1/chat-tags/chat_tag_123', 'PATCH', {}))
    )
    expect(response.status).toBe(200)
    expect(hoisted.updateChatTagMock).toHaveBeenCalledWith(TAG, {})
  })

  it('soft-deletes a conversation tag after parsing the id', async () => {
    hoisted.deleteChatTagMock.mockResolvedValue(undefined)

    const response = await tagDetailHandlers.DELETE(args({ tagId: TAG }))
    expect(response.status).toBe(204)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.CHAT_MANAGE
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TAG, 'chat_tag', 'chat tag ID')
    expect(hoisted.deleteChatTagMock).toHaveBeenCalledWith(TAG)
  })

  it('returns 403 before domain calls when each handler permission check fails', async () => {
    const cases = [
      [tagHandlers.GET, args()],
      [tagHandlers.POST, args({}, jsonRequest('http://test/api/v1/chat-tags', 'POST', {}))],
      [
        tagDetailHandlers.PATCH,
        args({ tagId: TAG }, jsonRequest('http://test/api/v1/chat-tags/chat_tag_123', 'PATCH', {})),
      ],
      [tagDetailHandlers.DELETE, args({ tagId: TAG })],
    ] as const

    for (const [handler, handlerArgs] of cases) {
      hoisted.hasPermissionMock.mockReturnValueOnce(false)
      const response = await handler(handlerArgs)
      expect(response.status).toBe(403)
    }

    expect(hoisted.listChatTagsWithCountsMock).not.toHaveBeenCalled()
    expect(hoisted.createChatTagMock).not.toHaveBeenCalled()
    expect(hoisted.updateChatTagMock).not.toHaveBeenCalled()
    expect(hoisted.deleteChatTagMock).not.toHaveBeenCalled()
  })

  it('rejects invalid request bodies before mutating conversation tags', async () => {
    const cases = [
      // Missing the required name.
      [tagHandlers.POST, args({}, jsonRequest('http://test/api/v1/chat-tags', 'POST', {}))],
      // Empty name fails the min(1) constraint.
      [
        tagHandlers.POST,
        args({}, jsonRequest('http://test/api/v1/chat-tags', 'POST', { name: '' })),
      ],
      // Malformed colour fails the hex regex.
      [
        tagHandlers.POST,
        args(
          {},
          jsonRequest('http://test/api/v1/chat-tags', 'POST', { name: 'Urgent', color: 'red' })
        ),
      ],
      // Non-JSON body resolves to null and fails the schema.
      [
        tagHandlers.POST,
        args({}, new Request('http://test/api/v1/chat-tags', { method: 'POST', body: 'not json' })),
      ],
      // PATCH with an over-length name fails the max(80) constraint.
      [
        tagDetailHandlers.PATCH,
        args(
          { tagId: TAG },
          jsonRequest('http://test/api/v1/chat-tags/chat_tag_123', 'PATCH', {
            name: 'x'.repeat(81),
          })
        ),
      ],
      // PATCH with a malformed colour fails the hex regex.
      [
        tagDetailHandlers.PATCH,
        args(
          { tagId: TAG },
          jsonRequest('http://test/api/v1/chat-tags/chat_tag_123', 'PATCH', { color: '#xyz' })
        ),
      ],
    ] as const

    for (const [handler, handlerArgs] of cases) {
      const response = await handler(handlerArgs as HandlerArgs)
      expect(response.status).toBe(400)
    }

    expect(hoisted.createChatTagMock).not.toHaveBeenCalled()
    expect(hoisted.updateChatTagMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    // The catch block delegates to handleDomainError; an unexpected throw
    // should surface as a 500 rather than escaping the handler.
    hoisted.listChatTagsWithCountsMock.mockRejectedValue(new Error('boom'))

    const response = await tagHandlers.GET(args())
    expect(response.status).toBe(500)
  })
})
