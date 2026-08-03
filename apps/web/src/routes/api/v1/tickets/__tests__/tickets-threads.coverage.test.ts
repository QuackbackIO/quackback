import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Request-level behaviour coverage for the ticket thread REST routes:
 *   - $ticketId.threads.ts            (GET, POST)
 *   - $ticketId.threads.$threadId.ts  (PATCH, DELETE)
 *
 * These routes do not use the scope/`assertScopeAllowed` mechanism. Instead they
 * authorise via the tickets domain `can*` helpers driven by `loadPermissionSet`.
 * We mock every collaborator each route imports and exercise every branch so the
 * suite drives both files to full line and branch coverage. British spelling is
 * used throughout (authorise, behaviour) per repo convention.
 */
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  addThreadMock: vi.fn(),
  listThreadsMock: vi.fn(),
  getTicketMock: vi.fn(),
  getThreadMock: vi.fn(),
  editThreadMock: vi.fn(),
  softDeleteThreadMock: vi.fn(),
  listSharesForTicketMock: vi.fn(),
  toResourceScopeMock: vi.fn(),
  canViewTicketMock: vi.fn(),
  canReplyPublicMock: vi.fn(),
  canCommentInternalMock: vi.fn(),
  canShareCrossTeamMock: vi.fn(),
  canEditFieldsMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => hoisted.loadPermissionSetMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/tickets', () => ({
  addThread: (...args: unknown[]) => hoisted.addThreadMock(...args),
  listThreads: (...args: unknown[]) => hoisted.listThreadsMock(...args),
  getTicket: (...args: unknown[]) => hoisted.getTicketMock(...args),
  getThread: (...args: unknown[]) => hoisted.getThreadMock(...args),
  editThread: (...args: unknown[]) => hoisted.editThreadMock(...args),
  softDeleteThread: (...args: unknown[]) => hoisted.softDeleteThreadMock(...args),
  listSharesForTicket: (...args: unknown[]) => hoisted.listSharesForTicketMock(...args),
  toResourceScope: (...args: unknown[]) => hoisted.toResourceScopeMock(...args),
  canViewTicket: (...args: unknown[]) => hoisted.canViewTicketMock(...args),
  canReplyPublic: (...args: unknown[]) => hoisted.canReplyPublicMock(...args),
  canCommentInternal: (...args: unknown[]) => hoisted.canCommentInternalMock(...args),
  canShareCrossTeam: (...args: unknown[]) => hoisted.canShareCrossTeamMock(...args),
  canEditFields: (...args: unknown[]) => hoisted.canEditFieldsMock(...args),
}))

vi.mock('@/lib/server/db', () => ({
  TICKET_THREAD_AUDIENCES: ['public', 'internal', 'shared_team'],
}))

import { Route as ThreadsRoute } from '../$ticketId.threads'
import { Route as ThreadDetailRoute } from '../$ticketId.threads.$threadId'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const threadsHandlers = (ThreadsRoute as unknown as RouteWithHandlers).options.server.handlers
const threadDetailHandlers = (ThreadDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_admin'
const TICKET = 'ticket_123'
const THREAD = 'ticket_thread_123'
const TEAM = 'team_456'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/tickets/ticket_123/threads')
) {
  return { request, params: handlerParams }
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    primaryTeamId: TEAM,
    assigneePrincipalId: null,
    assigneeTeamId: null,
    requesterPrincipalId: 'principal_requester',
    ...overrides,
  }
}

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: THREAD,
    ticketId: TICKET,
    principalId: PRINCIPAL,
    audience: 'internal',
    bodyText: 'hello',
    bodyJson: null,
    deletedAt: null,
    ...overrides,
  }
}

async function expectJsonData(response: Response) {
  return (await response.json()).data
}

const SCOPE = { kind: 'scope' }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'team',
    key: { scopes: [] },
  })
  hoisted.loadPermissionSetMock.mockResolvedValue({ teamIds: ['team_self'] })
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
  hoisted.getTicketMock.mockResolvedValue(ticket())
  hoisted.listSharesForTicketMock.mockResolvedValue([])
  hoisted.toResourceScopeMock.mockReturnValue(SCOPE)
  hoisted.canViewTicketMock.mockReturnValue(true)
  hoisted.canReplyPublicMock.mockReturnValue(true)
  hoisted.canCommentInternalMock.mockReturnValue(true)
  hoisted.canShareCrossTeamMock.mockReturnValue(true)
  hoisted.canEditFieldsMock.mockReturnValue(true)
})

describe('GET /api/v1/tickets/:ticketId/threads', () => {
  it('lists threads and threads the viewer context through when the caller is the requester', async () => {
    const rows = [thread()]
    hoisted.listThreadsMock.mockResolvedValue(rows)
    hoisted.getTicketMock.mockResolvedValue(ticket({ requesterPrincipalId: PRINCIPAL }))
    hoisted.canCommentInternalMock.mockReturnValue(true)
    // Exercise the shares.map() callback inside loadScope with a non-empty share list.
    hoisted.listSharesForTicketMock.mockResolvedValue([
      { teamId: TEAM, revokedAt: null },
      { teamId: 'team_other', revokedAt: new Date('2026-02-01') },
    ])

    const response = await threadsHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(rows)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TICKET, 'ticket', 'ticket ID')
    // The mapped shares are forwarded to toResourceScope.
    expect(hoisted.toResourceScopeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shares: [
          { teamId: TEAM, revokedAt: null },
          { teamId: 'team_other', revokedAt: new Date('2026-02-01') },
        ],
      })
    )
    expect(hoisted.listThreadsMock).toHaveBeenCalledWith(TICKET, {
      viewerTeamIds: ['team_self'],
      canSeeInternal: true,
      isRequester: true,
    })
  })

  it('marks isRequester false and canSeeInternal off for a non-requester without internal access', async () => {
    hoisted.listThreadsMock.mockResolvedValue([])
    // Default ticket requesterPrincipalId differs from the caller.
    hoisted.canCommentInternalMock.mockReturnValue(false)

    const response = await threadsHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(200)
    expect(hoisted.listThreadsMock).toHaveBeenCalledWith(TICKET, {
      viewerTeamIds: ['team_self'],
      canSeeInternal: false,
      isRequester: false,
    })
  })

  it('returns 404 when the ticket cannot be loaded', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)

    const response = await threadsHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(404)
    expect(hoisted.listThreadsMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot view the ticket', async () => {
    hoisted.canViewTicketMock.mockReturnValue(false)

    const response = await threadsHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(403)
    expect(hoisted.listThreadsMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.listThreadsMock.mockRejectedValue(new Error('boom'))

    const response = await threadsHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(500)
  })
})

describe('POST /api/v1/tickets/:ticketId/threads', () => {
  it('creates a thread, defaulting optional fields to null', async () => {
    const created = thread({ audience: 'public' })
    hoisted.addThreadMock.mockResolvedValue(created)

    const response = await threadsHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/threads', 'POST', {
          audience: 'public',
        })
      )
    )

    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(JSON.parse(JSON.stringify(created)))
    expect(hoisted.addThreadMock).toHaveBeenCalledWith({
      ticketId: TICKET,
      principalId: PRINCIPAL,
      audience: 'public',
      bodyJson: null,
      bodyText: null,
      sharedWithTeamId: null,
    })
  })

  it('passes through the provided optional body and shared team', async () => {
    const created = thread({ audience: 'shared_team' })
    hoisted.addThreadMock.mockResolvedValue(created)

    const response = await threadsHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/threads', 'POST', {
          audience: 'shared_team',
          bodyJson: { type: 'doc' },
          bodyText: 'a reply',
          sharedWithTeamId: TEAM,
        })
      )
    )

    expect(response.status).toBe(201)
    expect(hoisted.addThreadMock).toHaveBeenCalledWith({
      ticketId: TICKET,
      principalId: PRINCIPAL,
      audience: 'shared_team',
      bodyJson: { type: 'doc' },
      bodyText: 'a reply',
      sharedWithTeamId: TEAM,
    })
  })

  it('rejects an invalid body with 400 before loading the ticket', async () => {
    const response = await threadsHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/threads', 'POST', {
          audience: 'not-a-valid-audience',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.addThreadMock).not.toHaveBeenCalled()
  })

  it('treats an unparseable body as null and returns 400', async () => {
    const badJson = new Request('http://test/api/v1/tickets/ticket_123/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    const response = await threadsHandlers.POST(args({ ticketId: TICKET }, badJson))

    expect(response.status).toBe(400)
    expect(hoisted.addThreadMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the ticket cannot be loaded', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)

    const response = await threadsHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/threads', 'POST', {
          audience: 'public',
        })
      )
    )

    expect(response.status).toBe(404)
    expect(hoisted.addThreadMock).not.toHaveBeenCalled()
  })

  it('returns 403 for a public reply the caller cannot make', async () => {
    hoisted.canReplyPublicMock.mockReturnValue(false)

    const response = await threadsHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/threads', 'POST', {
          audience: 'public',
        })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.addThreadMock).not.toHaveBeenCalled()
  })

  it('returns 403 for an internal comment the caller cannot make', async () => {
    hoisted.canCommentInternalMock.mockReturnValue(false)

    const response = await threadsHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/threads', 'POST', {
          audience: 'internal',
        })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.addThreadMock).not.toHaveBeenCalled()
  })

  it('returns 403 for a cross-team share the caller cannot make', async () => {
    hoisted.canShareCrossTeamMock.mockReturnValue(false)

    const response = await threadsHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/threads', 'POST', {
          audience: 'shared_team',
        })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.addThreadMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.addThreadMock.mockRejectedValue(new Error('boom'))

    const response = await threadsHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/threads', 'POST', {
          audience: 'public',
        })
      )
    )

    expect(response.status).toBe(500)
  })
})

describe('PATCH /api/v1/tickets/:ticketId/threads/:threadId', () => {
  function patchRequest(body: unknown) {
    return jsonRequest(
      'http://test/api/v1/tickets/ticket_123/threads/ticket_thread_123',
      'PATCH',
      body
    )
  }

  it('edits a thread authored by the caller and defaults bodies to null', async () => {
    const updated = thread({ bodyText: 'edited' })
    hoisted.getThreadMock.mockResolvedValue(thread())
    hoisted.editThreadMock.mockResolvedValue(updated)
    // Exercise the shares.map() callback inside loadTicketScope with a non-empty list.
    hoisted.listSharesForTicketMock.mockResolvedValue([{ teamId: TEAM, revokedAt: null }])

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({ bodyText: 'edited' }))
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(JSON.parse(JSON.stringify(updated)))
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TICKET, 'ticket', 'ticket ID')
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(THREAD, 'ticket_thread', 'thread ID')
    expect(hoisted.toResourceScopeMock).toHaveBeenCalledWith(
      expect.objectContaining({ shares: [{ teamId: TEAM, revokedAt: null }] })
    )
    expect(hoisted.editThreadMock).toHaveBeenCalledWith({
      threadId: THREAD,
      actorPrincipalId: PRINCIPAL,
      bodyJson: null,
      bodyText: 'edited',
    })
  })

  it('treats an unparseable body as null and returns 400', async () => {
    const badJson = new Request('http://test/api/v1/tickets/ticket_123/threads/ticket_thread_123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, badJson)
    )

    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.editThreadMock).not.toHaveBeenCalled()
  })

  it('passes through a provided bodyJson document', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread())
    hoisted.editThreadMock.mockResolvedValue(thread())

    const response = await threadDetailHandlers.PATCH(
      args(
        { ticketId: TICKET, threadId: THREAD },
        patchRequest({ bodyJson: { type: 'doc', content: [] } })
      )
    )

    expect(response.status).toBe(200)
    expect(hoisted.editThreadMock).toHaveBeenCalledWith({
      threadId: THREAD,
      actorPrincipalId: PRINCIPAL,
      bodyJson: { type: 'doc', content: [] },
      bodyText: null,
    })
  })

  it('rejects an empty body (no bodyJson or bodyText) with 400', async () => {
    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({}))
    )

    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.editThreadMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the ticket cannot be loaded', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({ bodyText: 'x' }))
    )

    expect(response.status).toBe(404)
    expect(hoisted.editThreadMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot view the ticket', async () => {
    hoisted.canViewTicketMock.mockReturnValue(false)

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({ bodyText: 'x' }))
    )

    expect(response.status).toBe(403)
    expect(hoisted.editThreadMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the thread is missing', async () => {
    hoisted.getThreadMock.mockResolvedValue(null)

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({ bodyText: 'x' }))
    )

    expect(response.status).toBe(404)
    expect(hoisted.editThreadMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the thread is soft-deleted', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread({ deletedAt: new Date('2026-01-01') }))

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({ bodyText: 'x' }))
    )

    expect(response.status).toBe(404)
    expect(hoisted.editThreadMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the thread belongs to a different ticket', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread({ ticketId: 'ticket_other' }))

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({ bodyText: 'x' }))
    )

    expect(response.status).toBe(404)
    expect(hoisted.editThreadMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not the author (different principal)', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread({ principalId: 'principal_other' }))

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({ bodyText: 'x' }))
    )

    expect(response.status).toBe(403)
    expect(hoisted.editThreadMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the thread has no author (null principal)', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread({ principalId: null }))

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({ bodyText: 'x' }))
    )

    expect(response.status).toBe(403)
    expect(hoisted.editThreadMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread())
    hoisted.editThreadMock.mockRejectedValue(new Error('boom'))

    const response = await threadDetailHandlers.PATCH(
      args({ ticketId: TICKET, threadId: THREAD }, patchRequest({ bodyText: 'x' }))
    )

    expect(response.status).toBe(500)
  })
})

describe('DELETE /api/v1/tickets/:ticketId/threads/:threadId', () => {
  function deleteArgs(params: Record<string, string> = { ticketId: TICKET, threadId: THREAD }) {
    return args(
      params,
      new Request('http://test/api/v1/tickets/ticket_123/threads/ticket_thread_123', {
        method: 'DELETE',
      })
    )
  }

  it('soft-deletes a thread authored by the caller', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread())
    hoisted.softDeleteThreadMock.mockResolvedValue(undefined)

    const response = await threadDetailHandlers.DELETE(deleteArgs())

    expect(response.status).toBe(204)
    expect(hoisted.softDeleteThreadMock).toHaveBeenCalledWith(THREAD, PRINCIPAL)
  })

  it('soft-deletes a thread the caller did not author when they can moderate', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread({ principalId: 'principal_other' }))
    hoisted.canEditFieldsMock.mockReturnValue(true)
    hoisted.softDeleteThreadMock.mockResolvedValue(undefined)

    const response = await threadDetailHandlers.DELETE(deleteArgs())

    expect(response.status).toBe(204)
    expect(hoisted.softDeleteThreadMock).toHaveBeenCalledWith(THREAD, PRINCIPAL)
  })

  it('returns 404 when the ticket cannot be loaded', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)

    const response = await threadDetailHandlers.DELETE(deleteArgs())

    expect(response.status).toBe(404)
    expect(hoisted.softDeleteThreadMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot view the ticket', async () => {
    hoisted.canViewTicketMock.mockReturnValue(false)

    const response = await threadDetailHandlers.DELETE(deleteArgs())

    expect(response.status).toBe(403)
    expect(hoisted.softDeleteThreadMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the thread is missing', async () => {
    hoisted.getThreadMock.mockResolvedValue(null)

    const response = await threadDetailHandlers.DELETE(deleteArgs())

    expect(response.status).toBe(404)
    expect(hoisted.softDeleteThreadMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the thread belongs to a different ticket', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread({ ticketId: 'ticket_other' }))

    const response = await threadDetailHandlers.DELETE(deleteArgs())

    expect(response.status).toBe(404)
    expect(hoisted.softDeleteThreadMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is neither the author nor a moderator', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread({ principalId: 'principal_other' }))
    hoisted.canEditFieldsMock.mockReturnValue(false)

    const response = await threadDetailHandlers.DELETE(deleteArgs())

    expect(response.status).toBe(403)
    expect(hoisted.softDeleteThreadMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the thread has no author and the caller cannot moderate', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread({ principalId: null }))
    hoisted.canEditFieldsMock.mockReturnValue(false)

    const response = await threadDetailHandlers.DELETE(deleteArgs())

    expect(response.status).toBe(403)
    expect(hoisted.softDeleteThreadMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.getThreadMock.mockResolvedValue(thread())
    hoisted.softDeleteThreadMock.mockRejectedValue(new Error('boom'))

    const response = await threadDetailHandlers.DELETE(deleteArgs())

    expect(response.status).toBe(500)
  })
})
