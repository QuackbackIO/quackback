import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  hasPermissionForResourceMock: vi.fn(),
  bulkAssignMock: vi.fn(),
  bulkChangeInboxMock: vi.fn(),
  bulkTransitionMock: vi.fn(),
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

vi.mock('@/lib/server/domains/tickets', () => ({
  bulkAssign: (...args: unknown[]) => hoisted.bulkAssignMock(...args),
  bulkChangeInbox: (...args: unknown[]) => hoisted.bulkChangeInboxMock(...args),
  bulkTransition: (...args: unknown[]) => hoisted.bulkTransitionMock(...args),
}))

import { Route as BulkAssignRoute } from '../bulk.assign'
import { Route as BulkChangeInboxRoute } from '../bulk.change-inbox'
import { Route as BulkTransitionRoute } from '../bulk.transition'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const assignHandlers = (BulkAssignRoute as unknown as RouteWithHandlers).options.server.handlers
const changeInboxHandlers = (BulkChangeInboxRoute as unknown as RouteWithHandlers).options.server
  .handlers
const transitionHandlers = (BulkTransitionRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_admin'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// Builds a request whose body is invalid JSON so request.json() throws and the
// route's `.catch(() => null)` branch yields a null body for the zod schema.
function malformedRequest(url: string) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ not valid json',
  })
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
  hoisted.hasPermissionForResourceMock.mockReturnValue(true)
})

describe('POST /api/v1/tickets/bulk/assign', () => {
  it('assigns tickets after scope and permission checks', async () => {
    const result = { succeeded: ['ticket_1'], failed: [] }
    hoisted.bulkAssignMock.mockResolvedValue(result)

    const response = await assignHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/assign', 'POST', {
        ticketIds: ['ticket_1', 'ticket_2'],
        assigneePrincipalId: 'principal_agent',
        assigneeTeamId: null,
      }),
    })

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(result)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TICKET_BULK_OPERATE
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.TICKET_BULK_OPERATE
    )
    // The route coalesces an explicit null assigneeTeamId to undefined via `?? undefined`.
    expect(hoisted.bulkAssignMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketIds: ['ticket_1', 'ticket_2'],
        actorPrincipalId: PRINCIPAL,
        assigneePrincipalId: 'principal_agent',
        assigneeTeamId: undefined,
        permit: expect.any(Function),
      })
    )

    // Exercise the permit callback so the hasPermissionForResource arrow is covered.
    const { permit } = hoisted.bulkAssignMock.mock.calls[0][0] as {
      permit: (scope: unknown) => boolean
    }
    const scope = { kind: 'team', teamId: 'team_1' }
    expect(permit(scope)).toBe(true)
    expect(hoisted.hasPermissionForResourceMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.TICKET_ASSIGN_ANY,
      scope
    )
  })

  it('coalesces an omitted assigneePrincipalId to undefined', async () => {
    hoisted.bulkAssignMock.mockResolvedValue({ succeeded: [], failed: [] })

    const response = await assignHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/assign', 'POST', {
        ticketIds: ['ticket_1'],
      }),
    })

    expect(response.status).toBe(200)
    expect(hoisted.bulkAssignMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneePrincipalId: undefined,
        assigneeTeamId: undefined,
      })
    )
  })

  it('returns 403 when bulk-operate permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await assignHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/assign', 'POST', {
        ticketIds: ['ticket_1'],
      }),
    })

    expect(response.status).toBe(403)
    expect(hoisted.bulkAssignMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body', async () => {
    const response = await assignHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/assign', 'POST', {
        ticketIds: [],
      }),
    })

    expect(response.status).toBe(400)
    expect(hoisted.bulkAssignMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const response = await assignHandlers.POST({
      params: {},
      request: malformedRequest('http://test/api/v1/tickets/bulk/assign'),
    })

    expect(response.status).toBe(400)
    expect(hoisted.bulkAssignMock).not.toHaveBeenCalled()
  })

  it('delegates thrown domain errors to handleDomainError', async () => {
    hoisted.withApiKeyAuthMock.mockRejectedValue(new Error('unauthorised'))

    const response = await assignHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/assign', 'POST', {
        ticketIds: ['ticket_1'],
      }),
    })

    expect(response.status).toBe(500)
    expect(hoisted.bulkAssignMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/tickets/bulk/change-inbox', () => {
  it('changes inbox for tickets after scope and permission checks', async () => {
    const result = { succeeded: ['ticket_1'], failed: [] }
    hoisted.bulkChangeInboxMock.mockResolvedValue(result)

    const response = await changeInboxHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/change-inbox', 'POST', {
        ticketIds: ['ticket_1'],
        inboxId: 'inbox_1',
      }),
    })

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(result)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TICKET_BULK_OPERATE
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.TICKET_BULK_OPERATE
    )
    expect(hoisted.bulkChangeInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketIds: ['ticket_1'],
        actorPrincipalId: PRINCIPAL,
        inboxId: 'inbox_1',
        permit: expect.any(Function),
      })
    )

    // Exercise the permit callback so the hasPermissionForResource arrow is covered.
    const { permit } = hoisted.bulkChangeInboxMock.mock.calls[0][0] as {
      permit: (scope: unknown) => boolean
    }
    const scope = { kind: 'team', teamId: 'team_1' }
    expect(permit(scope)).toBe(true)
    expect(hoisted.hasPermissionForResourceMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.TICKET_EDIT_FIELDS,
      scope
    )
  })

  it('accepts a null inboxId (unassigning the inbox)', async () => {
    hoisted.bulkChangeInboxMock.mockResolvedValue({ succeeded: [], failed: [] })

    const response = await changeInboxHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/change-inbox', 'POST', {
        ticketIds: ['ticket_1'],
        inboxId: null,
      }),
    })

    expect(response.status).toBe(200)
    expect(hoisted.bulkChangeInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ inboxId: null })
    )
  })

  it('returns 403 when bulk-operate permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await changeInboxHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/change-inbox', 'POST', {
        ticketIds: ['ticket_1'],
        inboxId: 'inbox_1',
      }),
    })

    expect(response.status).toBe(403)
    expect(hoisted.bulkChangeInboxMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body', async () => {
    const response = await changeInboxHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/change-inbox', 'POST', {
        ticketIds: ['ticket_1'],
        // inboxId omitted — the schema requires the key (string | null)
      }),
    })

    expect(response.status).toBe(400)
    expect(hoisted.bulkChangeInboxMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const response = await changeInboxHandlers.POST({
      params: {},
      request: malformedRequest('http://test/api/v1/tickets/bulk/change-inbox'),
    })

    expect(response.status).toBe(400)
    expect(hoisted.bulkChangeInboxMock).not.toHaveBeenCalled()
  })

  it('delegates thrown domain errors to handleDomainError', async () => {
    hoisted.bulkChangeInboxMock.mockRejectedValue(new Error('boom'))

    const response = await changeInboxHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/change-inbox', 'POST', {
        ticketIds: ['ticket_1'],
        inboxId: 'inbox_1',
      }),
    })

    expect(response.status).toBe(500)
  })
})

describe('POST /api/v1/tickets/bulk/transition', () => {
  it('transitions tickets after scope and permission checks', async () => {
    const result = { succeeded: ['ticket_1'], failed: [] }
    hoisted.bulkTransitionMock.mockResolvedValue(result)

    const response = await transitionHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/transition', 'POST', {
        ticketIds: ['ticket_1'],
        statusId: 'status_1',
      }),
    })

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(result)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TICKET_BULK_OPERATE
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.TICKET_BULK_OPERATE
    )
    expect(hoisted.bulkTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketIds: ['ticket_1'],
        actorPrincipalId: PRINCIPAL,
        statusId: 'status_1',
        permit: expect.any(Function),
      })
    )

    // Exercise the permit callback so the hasPermissionForResource arrow is covered.
    const { permit } = hoisted.bulkTransitionMock.mock.calls[0][0] as {
      permit: (scope: unknown) => boolean
    }
    const scope = { kind: 'team', teamId: 'team_1' }
    expect(permit(scope)).toBe(true)
    expect(hoisted.hasPermissionForResourceMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.TICKET_EDIT_FIELDS,
      scope
    )
  })

  it('returns 403 when bulk-operate permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await transitionHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/transition', 'POST', {
        ticketIds: ['ticket_1'],
        statusId: 'status_1',
      }),
    })

    expect(response.status).toBe(403)
    expect(hoisted.bulkTransitionMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body', async () => {
    const response = await transitionHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/transition', 'POST', {
        ticketIds: ['ticket_1'],
        statusId: '',
      }),
    })

    expect(response.status).toBe(400)
    expect(hoisted.bulkTransitionMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const response = await transitionHandlers.POST({
      params: {},
      request: malformedRequest('http://test/api/v1/tickets/bulk/transition'),
    })

    expect(response.status).toBe(400)
    expect(hoisted.bulkTransitionMock).not.toHaveBeenCalled()
  })

  it('delegates thrown domain errors to handleDomainError', async () => {
    hoisted.bulkTransitionMock.mockRejectedValue(new Error('boom'))

    const response = await transitionHandlers.POST({
      params: {},
      request: jsonRequest('http://test/api/v1/tickets/bulk/transition', 'POST', {
        ticketIds: ['ticket_1'],
        statusId: 'status_1',
      }),
    })

    expect(response.status).toBe(500)
  })
})
