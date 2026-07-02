import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Request-level behaviour coverage for the ticket participants and shares
 * REST route handlers. These routes authorise via the tickets-domain
 * permission helpers (canViewTicket / canManageParticipants /
 * canShareCrossTeam) rather than the generic assertScopeAllowed +
 * hasPermission pair, so the mocks mirror the sibling thread-attachments
 * test rather than the inboxes reference verbatim.
 */

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  getTicketMock: vi.fn(),
  listSharesForTicketMock: vi.fn(),
  toResourceScopeMock: vi.fn(),
  canViewTicketMock: vi.fn(),
  canManageParticipantsMock: vi.fn(),
  canShareCrossTeamMock: vi.fn(),
  addParticipantMock: vi.fn(),
  listParticipantsMock: vi.fn(),
  removeParticipantMock: vi.fn(),
  shareTicketWithTeamMock: vi.fn(),
  revokeShareMock: vi.fn(),
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
  addParticipant: (...args: unknown[]) => hoisted.addParticipantMock(...args),
  listParticipants: (...args: unknown[]) => hoisted.listParticipantsMock(...args),
  removeParticipant: (...args: unknown[]) => hoisted.removeParticipantMock(...args),
  shareTicketWithTeam: (...args: unknown[]) => hoisted.shareTicketWithTeamMock(...args),
  revokeShare: (...args: unknown[]) => hoisted.revokeShareMock(...args),
  getTicket: (...args: unknown[]) => hoisted.getTicketMock(...args),
  listSharesForTicket: (...args: unknown[]) => hoisted.listSharesForTicketMock(...args),
  toResourceScope: (...args: unknown[]) => hoisted.toResourceScopeMock(...args),
  canViewTicket: (...args: unknown[]) => hoisted.canViewTicketMock(...args),
  canManageParticipants: (...args: unknown[]) => hoisted.canManageParticipantsMock(...args),
  canShareCrossTeam: (...args: unknown[]) => hoisted.canShareCrossTeamMock(...args),
}))

vi.mock('@/lib/server/db', () => ({
  TICKET_PARTICIPANT_ROLES: ['watcher', 'collaborator', 'cc'],
  TICKET_SHARE_LEVELS: ['read', 'comment', 'full'],
}))

import { Route as ParticipantDetailRoute } from '../$ticketId.participants.$participantId'
import { Route as ParticipantsRoute } from '../$ticketId.participants'
import { Route as ShareDetailRoute } from '../$ticketId.shares.$shareId'
import { Route as SharesRoute } from '../$ticketId.shares'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const participantHandlers = (ParticipantsRoute as unknown as RouteWithHandlers).options.server
  .handlers
const participantDetailHandlers = (ParticipantDetailRoute as unknown as RouteWithHandlers).options
  .server.handlers
const shareHandlers = (SharesRoute as unknown as RouteWithHandlers).options.server.handlers
const shareDetailHandlers = (ShareDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_agent'
const TICKET = 'ticket_123'
const PARTICIPANT = 'ticket_part_123'
const SHARE = 'ticket_share_123'
const SCOPE = { kind: 'ticket-scope' }

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(handlerParams: Record<string, string> = {}, request = new Request('http://test/x')) {
  return { request, params: handlerParams }
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    primaryTeamId: 'team_primary',
    assigneePrincipalId: null,
    assigneeTeamId: null,
    ...overrides,
  }
}

function participant(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTICIPANT,
    ticketId: TICKET,
    role: 'watcher',
    principalId: null,
    contactId: null,
    addedByPrincipalId: PRINCIPAL,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function share(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE,
    ticketId: TICKET,
    teamId: 'team_shared',
    accessLevel: 'read',
    revokedAt: null,
    grantedByPrincipalId: PRINCIPAL,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
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
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
  hoisted.getTicketMock.mockResolvedValue(ticket())
  hoisted.listSharesForTicketMock.mockResolvedValue([share()])
  hoisted.toResourceScopeMock.mockReturnValue(SCOPE)
  hoisted.canViewTicketMock.mockReturnValue(true)
  hoisted.canManageParticipantsMock.mockReturnValue(true)
  hoisted.canShareCrossTeamMock.mockReturnValue(true)
  hoisted.listParticipantsMock.mockResolvedValue([participant()])
  hoisted.addParticipantMock.mockResolvedValue(participant())
  hoisted.removeParticipantMock.mockResolvedValue(undefined)
  hoisted.shareTicketWithTeamMock.mockResolvedValue(share())
  hoisted.revokeShareMock.mockResolvedValue(undefined)
})

describe('GET /api/v1/tickets/:ticketId/participants', () => {
  it('lists participants after auth, ticket lookup, scope build, and view check', async () => {
    const response = await participantHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual(JSON.parse(JSON.stringify([participant()])))
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TICKET, 'ticket', 'ticket ID')
    expect(hoisted.getTicketMock).toHaveBeenCalledWith(TICKET)
    expect(hoisted.listSharesForTicketMock).toHaveBeenCalledWith(TICKET)
    // The route builds the resource scope from the ticket and its shares.
    expect(hoisted.toResourceScopeMock).toHaveBeenCalledWith({
      primaryTeamId: 'team_primary',
      assigneePrincipalId: null,
      assigneeTeamId: null,
      shares: [{ teamId: 'team_shared', revokedAt: null }],
    })
    expect(hoisted.canViewTicketMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
    expect(hoisted.listParticipantsMock).toHaveBeenCalledWith(TICKET)
  })

  it('returns 404 when the ticket does not exist', async () => {
    hoisted.getTicketMock.mockResolvedValueOnce(null)

    const response = await participantHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(404)
    expect(hoisted.listSharesForTicketMock).not.toHaveBeenCalled()
    expect(hoisted.listParticipantsMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot view the ticket', async () => {
    hoisted.canViewTicketMock.mockReturnValue(false)

    const response = await participantHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(403)
    expect(hoisted.listParticipantsMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.getTicketMock.mockRejectedValueOnce({ code: 'CONFLICT', message: 'boom' })

    const response = await participantHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(409)
  })
})

describe('POST /api/v1/tickets/:ticketId/participants', () => {
  it('adds a participant, coalescing omitted principalId and contactId to null', async () => {
    const response = await participantHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { role: 'watcher' }))
    )

    expect(response.status).toBe(201)
    expect(hoisted.canManageParticipantsMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
    expect(hoisted.addParticipantMock).toHaveBeenCalledWith({
      ticketId: TICKET,
      role: 'watcher',
      principalId: null,
      contactId: null,
      addedByPrincipalId: PRINCIPAL,
    })
  })

  it('passes through provided principalId and contactId values', async () => {
    const response = await participantHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/x', 'POST', {
          role: 'collaborator',
          principalId: 'principal_other',
          contactId: 'contact_99',
        })
      )
    )

    expect(response.status).toBe(201)
    expect(hoisted.addParticipantMock).toHaveBeenCalledWith({
      ticketId: TICKET,
      role: 'collaborator',
      principalId: 'principal_other',
      contactId: 'contact_99',
      addedByPrincipalId: PRINCIPAL,
    })
  })

  it('returns 400 for an invalid request body without calling the service', async () => {
    const response = await participantHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { role: 'invalid' }))
    )

    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.addParticipantMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not valid JSON', async () => {
    // request.json() rejects, so the route coalesces to null which fails parsing.
    const malformed = new Request('http://test/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const response = await participantHandlers.POST(args({ ticketId: TICKET }, malformed))

    expect(response.status).toBe(400)
    expect(hoisted.addParticipantMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValueOnce(null)

    const response = await participantHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { role: 'watcher' }))
    )

    expect(response.status).toBe(404)
    expect(hoisted.addParticipantMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot manage participants', async () => {
    hoisted.canManageParticipantsMock.mockReturnValue(false)

    const response = await participantHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { role: 'watcher' }))
    )

    expect(response.status).toBe(403)
    expect(hoisted.addParticipantMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.addParticipantMock.mockRejectedValueOnce({ code: 'CONFLICT', message: 'dupe' })

    const response = await participantHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { role: 'watcher' }))
    )

    expect(response.status).toBe(409)
  })
})

describe('DELETE /api/v1/tickets/:ticketId/participants/:participantId', () => {
  it('removes a participant after parsing both ids and the manage check', async () => {
    const response = await participantDetailHandlers.DELETE(
      args({ ticketId: TICKET, participantId: PARTICIPANT })
    )

    expect(response.status).toBe(204)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TICKET, 'ticket', 'ticket ID')
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(
      PARTICIPANT,
      'ticket_part',
      'participant ID'
    )
    expect(hoisted.canManageParticipantsMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
    expect(hoisted.removeParticipantMock).toHaveBeenCalledWith(PARTICIPANT, PRINCIPAL)
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValueOnce(null)

    const response = await participantDetailHandlers.DELETE(
      args({ ticketId: TICKET, participantId: PARTICIPANT })
    )

    expect(response.status).toBe(404)
    expect(hoisted.removeParticipantMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot manage participants', async () => {
    hoisted.canManageParticipantsMock.mockReturnValue(false)

    const response = await participantDetailHandlers.DELETE(
      args({ ticketId: TICKET, participantId: PARTICIPANT })
    )

    expect(response.status).toBe(403)
    expect(hoisted.removeParticipantMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.removeParticipantMock.mockRejectedValueOnce({ code: 'CONFLICT', message: 'nope' })

    const response = await participantDetailHandlers.DELETE(
      args({ ticketId: TICKET, participantId: PARTICIPANT })
    )

    expect(response.status).toBe(409)
  })
})

describe('GET /api/v1/tickets/:ticketId/shares', () => {
  it('lists active shares after the view check', async () => {
    const response = await shareHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual(JSON.parse(JSON.stringify([share()])))
    expect(hoisted.getTicketMock).toHaveBeenCalledWith(TICKET)
    expect(hoisted.canViewTicketMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValueOnce(null)

    const response = await shareHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(404)
  })

  it('returns 403 when the caller cannot view the ticket', async () => {
    hoisted.canViewTicketMock.mockReturnValue(false)

    const response = await shareHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(403)
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.listSharesForTicketMock.mockRejectedValueOnce({ code: 'CONFLICT', message: 'boom' })

    const response = await shareHandlers.GET(args({ ticketId: TICKET }))

    expect(response.status).toBe(409)
  })
})

describe('POST /api/v1/tickets/:ticketId/shares', () => {
  it('shares the ticket with a team, forwarding an explicit accessLevel', async () => {
    const response = await shareHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/x', 'POST', { teamId: 'team_b', accessLevel: 'full' })
      )
    )

    expect(response.status).toBe(201)
    expect(hoisted.canShareCrossTeamMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
    expect(hoisted.shareTicketWithTeamMock).toHaveBeenCalledWith({
      ticketId: TICKET,
      teamId: 'team_b',
      accessLevel: 'full',
      grantedByPrincipalId: PRINCIPAL,
    })
  })

  it('omits accessLevel when the caller does not supply one', async () => {
    const response = await shareHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { teamId: 'team_b' }))
    )

    expect(response.status).toBe(201)
    expect(hoisted.shareTicketWithTeamMock).toHaveBeenCalledWith({
      ticketId: TICKET,
      teamId: 'team_b',
      accessLevel: undefined,
      grantedByPrincipalId: PRINCIPAL,
    })
  })

  it('returns 400 for an invalid request body without calling the service', async () => {
    const response = await shareHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { teamId: '' }))
    )

    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.shareTicketWithTeamMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not valid JSON', async () => {
    // request.json() rejects, so the route's .catch coalesces to null which fails parsing.
    const malformed = new Request('http://test/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const response = await shareHandlers.POST(args({ ticketId: TICKET }, malformed))

    expect(response.status).toBe(400)
    expect(hoisted.shareTicketWithTeamMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValueOnce(null)

    const response = await shareHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { teamId: 'team_b' }))
    )

    expect(response.status).toBe(404)
    expect(hoisted.shareTicketWithTeamMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot share cross-team', async () => {
    hoisted.canShareCrossTeamMock.mockReturnValue(false)

    const response = await shareHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { teamId: 'team_b' }))
    )

    expect(response.status).toBe(403)
    expect(hoisted.shareTicketWithTeamMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.shareTicketWithTeamMock.mockRejectedValueOnce({ code: 'CONFLICT', message: 'dupe' })

    const response = await shareHandlers.POST(
      args({ ticketId: TICKET }, jsonRequest('http://test/x', 'POST', { teamId: 'team_b' }))
    )

    expect(response.status).toBe(409)
  })
})

describe('DELETE /api/v1/tickets/:ticketId/shares/:shareId', () => {
  it('revokes a share after parsing both ids and the cross-team check', async () => {
    const response = await shareDetailHandlers.DELETE(args({ ticketId: TICKET, shareId: SHARE }))

    expect(response.status).toBe(204)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TICKET, 'ticket', 'ticket ID')
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(SHARE, 'ticket_share', 'share ID')
    expect(hoisted.canShareCrossTeamMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
    expect(hoisted.revokeShareMock).toHaveBeenCalledWith(SHARE, PRINCIPAL)
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValueOnce(null)

    const response = await shareDetailHandlers.DELETE(args({ ticketId: TICKET, shareId: SHARE }))

    expect(response.status).toBe(404)
    expect(hoisted.revokeShareMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot share cross-team', async () => {
    hoisted.canShareCrossTeamMock.mockReturnValue(false)

    const response = await shareDetailHandlers.DELETE(args({ ticketId: TICKET, shareId: SHARE }))

    expect(response.status).toBe(403)
    expect(hoisted.revokeShareMock).not.toHaveBeenCalled()
  })

  it('routes thrown domain errors through handleDomainError', async () => {
    hoisted.revokeShareMock.mockRejectedValueOnce({ code: 'CONFLICT', message: 'nope' })

    const response = await shareDetailHandlers.DELETE(args({ ticketId: TICKET, shareId: SHARE }))

    expect(response.status).toBe(409)
  })
})
