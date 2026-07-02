import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

/**
 * Request-level behaviour tests for the ticket lifecycle REST routes:
 *   - POST /api/v1/tickets/:ticketId/assign
 *   - POST /api/v1/tickets/:ticketId/take
 *   - POST /api/v1/tickets/:ticketId/return
 *   - POST /api/v1/tickets/:ticketId/restore
 *   - GET  /api/v1/tickets/:ticketId/sla
 *
 * Each handler is exercised for its success path, permission denials, body
 * validation and not-found branches, plus every conditional toggle in the
 * source (self-assignment, includeAll, the assign-any/assign-self OR branch).
 */

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  hasPermissionForResourceMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  // tickets domain
  assignTicketMock: vi.fn(),
  takeTicketMock: vi.fn(),
  returnTicketMock: vi.fn(),
  restoreTicketMock: vi.fn(),
  getTicketMock: vi.fn(),
  listSharesForTicketMock: vi.fn(),
  toResourceScopeMock: vi.fn(),
  canAssignMock: vi.fn(),
  canAssignSelfMock: vi.fn(),
  // sla domain
  getActiveClocksForTicketMock: vi.fn(),
  getAllClocksForTicketMock: vi.fn(),
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
  hasPermissionForResource: (...args: unknown[]) => hoisted.hasPermissionForResourceMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/tickets', () => ({
  assignTicket: (...args: unknown[]) => hoisted.assignTicketMock(...args),
  takeTicket: (...args: unknown[]) => hoisted.takeTicketMock(...args),
  returnTicket: (...args: unknown[]) => hoisted.returnTicketMock(...args),
  restoreTicket: (...args: unknown[]) => hoisted.restoreTicketMock(...args),
  getTicket: (...args: unknown[]) => hoisted.getTicketMock(...args),
  listSharesForTicket: (...args: unknown[]) => hoisted.listSharesForTicketMock(...args),
  toResourceScope: (...args: unknown[]) => hoisted.toResourceScopeMock(...args),
  canAssign: (...args: unknown[]) => hoisted.canAssignMock(...args),
  canAssignSelf: (...args: unknown[]) => hoisted.canAssignSelfMock(...args),
}))

vi.mock('@/lib/server/domains/sla', () => ({
  getActiveClocksForTicket: (...args: unknown[]) => hoisted.getActiveClocksForTicketMock(...args),
  getAllClocksForTicket: (...args: unknown[]) => hoisted.getAllClocksForTicketMock(...args),
}))

import { Route as AssignRoute } from '../$ticketId.assign'
import { Route as RestoreRoute } from '../$ticketId.restore'
import { Route as ReturnRoute } from '../$ticketId.return'
import { Route as SlaRoute } from '../$ticketId.sla'
import { Route as TakeRoute } from '../$ticketId.take'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const assignHandlers = (AssignRoute as unknown as RouteWithHandlers).options.server.handlers
const takeHandlers = (TakeRoute as unknown as RouteWithHandlers).options.server.handlers
const returnHandlers = (ReturnRoute as unknown as RouteWithHandlers).options.server.handlers
const restoreHandlers = (RestoreRoute as unknown as RouteWithHandlers).options.server.handlers
const slaHandlers = (SlaRoute as unknown as RouteWithHandlers).options.server.handlers

const PRINCIPAL = 'principal_admin'
const TICKET = 'ticket_123'
const SCOPE = { kind: 'ticket-scope' }
const UPDATED_AT = '2026-01-01T00:00:00.000Z'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = { ticketId: TICKET },
  request = new Request('http://test/api/v1/tickets/ticket_123/x')
) {
  return { request, params: handlerParams }
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    primaryTeamId: 'team_primary',
    assigneePrincipalId: null,
    assigneeTeamId: null,
    updatedAt: new Date(UPDATED_AT),
    ...overrides,
  }
}

async function responseData(response: Response) {
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
  hoisted.hasPermissionForResourceMock.mockReturnValue(true)
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
  hoisted.getTicketMock.mockResolvedValue(ticket())
  hoisted.listSharesForTicketMock.mockResolvedValue([{ teamId: 'team_shared', revokedAt: null }])
  hoisted.toResourceScopeMock.mockReturnValue(SCOPE)
  hoisted.canAssignMock.mockReturnValue(true)
  hoisted.canAssignSelfMock.mockReturnValue(true)
  hoisted.assignTicketMock.mockResolvedValue(ticket({ assigneeTeamId: 'team_other' }))
  hoisted.takeTicketMock.mockResolvedValue(ticket({ assigneePrincipalId: PRINCIPAL }))
  hoisted.returnTicketMock.mockResolvedValue(ticket({ assigneePrincipalId: null }))
  hoisted.restoreTicketMock.mockResolvedValue(ticket({ deletedAt: null }))
  hoisted.getActiveClocksForTicketMock.mockResolvedValue([{ id: 'clk_active' }])
  hoisted.getAllClocksForTicketMock.mockResolvedValue([{ id: 'clk_active' }, { id: 'clk_done' }])
})

describe('POST /api/v1/tickets/:ticketId/assign', () => {
  it('assigns a ticket to another team after a team-level permission check', async () => {
    const response = await assignHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/assign', 'POST', {
          expectedUpdatedAt: UPDATED_AT,
          assigneePrincipalId: null,
          assigneeTeamId: 'team_other',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.toResourceScopeMock).toHaveBeenCalledWith({
      primaryTeamId: 'team_primary',
      assigneePrincipalId: null,
      assigneeTeamId: null,
      shares: [{ teamId: 'team_shared', revokedAt: null }],
    })
    // assigneePrincipalId is null (not the caller), so the broad canAssign check is used.
    expect(hoisted.canAssignMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
    expect(hoisted.canAssignSelfMock).not.toHaveBeenCalled()
    expect(hoisted.assignTicketMock).toHaveBeenCalledWith(TICKET, {
      expectedUpdatedAt: new Date(UPDATED_AT),
      actorPrincipalId: PRINCIPAL,
      assigneePrincipalId: null,
      assigneeTeamId: 'team_other',
    })
  })

  it('uses the self-assignment check when assigning to the calling principal', async () => {
    const response = await assignHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/assign', 'POST', {
          expectedUpdatedAt: UPDATED_AT,
          assigneePrincipalId: PRINCIPAL,
        })
      )
    )

    expect(response.status).toBe(200)
    expect(hoisted.canAssignSelfMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
    expect(hoisted.canAssignMock).not.toHaveBeenCalled()
    // Optional assigneeTeamId is absent, so the handler coalesces it to null.
    expect(hoisted.assignTicketMock).toHaveBeenCalledWith(
      TICKET,
      expect.objectContaining({ assigneePrincipalId: PRINCIPAL, assigneeTeamId: null })
    )
  })

  it('returns 403 when the assignment permission check fails', async () => {
    hoisted.canAssignMock.mockReturnValue(false)

    const response = await assignHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/assign', 'POST', {
          expectedUpdatedAt: UPDATED_AT,
          assigneeTeamId: 'team_other',
        })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.assignTicketMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body without calling the service', async () => {
    const response = await assignHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/assign', 'POST', {
          expectedUpdatedAt: 'not-a-datetime',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.assignTicketMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the request body is not valid JSON', async () => {
    // A malformed body makes request.json() reject; the handler's .catch(() => null)
    // arrow coalesces it to null, which then fails safeParse.
    const malformed = new Request('http://test/api/v1/tickets/ticket_123/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const response = await assignHandlers.POST(args({ ticketId: TICKET }, malformed))

    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.assignTicketMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the ticket does not exist', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)

    const response = await assignHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/assign', 'POST', {
          expectedUpdatedAt: UPDATED_AT,
        })
      )
    )

    expect(response.status).toBe(404)
    expect(hoisted.assignTicketMock).not.toHaveBeenCalled()
  })

  it('routes domain errors through handleDomainError', async () => {
    hoisted.withApiKeyAuthMock.mockRejectedValue(new Error('boom'))

    const response = await assignHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/assign', 'POST', {
          expectedUpdatedAt: UPDATED_AT,
        })
      )
    )

    expect(response.status).toBe(500)
  })
})

describe('POST /api/v1/tickets/:ticketId/take', () => {
  it('takes a ticket after a resource-scoped self-assign permission check', async () => {
    const response = await takeHandlers.POST(args())

    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual(
      JSON.parse(JSON.stringify(ticket({ assigneePrincipalId: PRINCIPAL })))
    )
    expect(hoisted.hasPermissionForResourceMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.TICKET_ASSIGN_SELF,
      SCOPE
    )
    expect(hoisted.takeTicketMock).toHaveBeenCalledWith(TICKET, PRINCIPAL)
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)

    const response = await takeHandlers.POST(args())

    expect(response.status).toBe(404)
    expect(hoisted.takeTicketMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller lacks the self-assign permission', async () => {
    hoisted.hasPermissionForResourceMock.mockReturnValue(false)

    const response = await takeHandlers.POST(args())

    expect(response.status).toBe(403)
    expect(hoisted.takeTicketMock).not.toHaveBeenCalled()
  })

  it('routes domain errors through handleDomainError', async () => {
    hoisted.takeTicketMock.mockRejectedValue(new Error('boom'))

    const response = await takeHandlers.POST(args())

    expect(response.status).toBe(500)
  })
})

describe('POST /api/v1/tickets/:ticketId/return', () => {
  it('returns a ticket when the caller has the assign-any permission', async () => {
    const response = await returnHandlers.POST(args())

    expect(response.status).toBe(200)
    expect(hoisted.hasPermissionForResourceMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.TICKET_ASSIGN_ANY,
      SCOPE
    )
    expect(hoisted.returnTicketMock).toHaveBeenCalledWith(TICKET, PRINCIPAL)
  })

  it('falls back to the assign-self permission when assign-any is missing', async () => {
    // First call (assign_any) fails, second call (assign_self) succeeds via the OR branch.
    hoisted.hasPermissionForResourceMock.mockReturnValueOnce(false).mockReturnValueOnce(true)

    const response = await returnHandlers.POST(args())

    expect(response.status).toBe(200)
    expect(hoisted.hasPermissionForResourceMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Set),
      PERMISSIONS.TICKET_ASSIGN_SELF,
      SCOPE
    )
    expect(hoisted.returnTicketMock).toHaveBeenCalledWith(TICKET, PRINCIPAL)
  })

  it('returns 403 when neither assign permission is granted', async () => {
    hoisted.hasPermissionForResourceMock.mockReturnValue(false)

    const response = await returnHandlers.POST(args())

    expect(response.status).toBe(403)
    expect(hoisted.returnTicketMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)

    const response = await returnHandlers.POST(args())

    expect(response.status).toBe(404)
    expect(hoisted.returnTicketMock).not.toHaveBeenCalled()
  })

  it('routes domain errors through handleDomainError', async () => {
    hoisted.returnTicketMock.mockRejectedValue(new Error('boom'))

    const response = await returnHandlers.POST(args())

    expect(response.status).toBe(500)
  })
})

describe('POST /api/v1/tickets/:ticketId/restore', () => {
  it('restores a soft-deleted ticket as an admin API key', async () => {
    const response = await restoreHandlers.POST(args())

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'admin' })
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TICKET, 'ticket', 'ticket ID')
    expect(hoisted.restoreTicketMock).toHaveBeenCalledWith(TICKET, PRINCIPAL)
  })

  it('routes domain errors through handleDomainError', async () => {
    hoisted.restoreTicketMock.mockRejectedValue(new Error('boom'))

    const response = await restoreHandlers.POST(args())

    expect(response.status).toBe(500)
    expect(hoisted.restoreTicketMock).toHaveBeenCalled()
  })
})

describe('GET /api/v1/tickets/:ticketId/sla', () => {
  it('returns active SLA clocks after scope and permission checks', async () => {
    const response = await slaHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual({ clocks: [{ id: 'clk_active' }] })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_VIEW
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(expect.any(Set), PERMISSIONS.SLA_VIEW)
    expect(hoisted.getActiveClocksForTicketMock).toHaveBeenCalledWith(TICKET)
    expect(hoisted.getAllClocksForTicketMock).not.toHaveBeenCalled()
  })

  it('returns all SLA clocks when includeAll=true', async () => {
    const response = await slaHandlers.GET(
      args(
        { ticketId: TICKET },
        new Request('http://test/api/v1/tickets/ticket_123/sla?includeAll=true')
      )
    )

    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual({
      clocks: [{ id: 'clk_active' }, { id: 'clk_done' }],
    })
    expect(hoisted.getAllClocksForTicketMock).toHaveBeenCalledWith(TICKET)
    expect(hoisted.getActiveClocksForTicketMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the sla.view permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await slaHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.getActiveClocksForTicketMock).not.toHaveBeenCalled()
    expect(hoisted.getAllClocksForTicketMock).not.toHaveBeenCalled()
  })

  it('routes domain errors through handleDomainError', async () => {
    hoisted.assertScopeAllowedMock.mockImplementation(() => {
      throw new Error('scope denied')
    })

    const response = await slaHandlers.GET(args())

    expect(response.status).toBe(500)
  })
})
