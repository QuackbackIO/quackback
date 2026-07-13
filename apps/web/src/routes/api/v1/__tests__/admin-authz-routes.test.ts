import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listAuditEventsMock: vi.fn(),
  revokeRoleAssignmentMock: vi.fn(),
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

vi.mock('@/lib/server/domains/audit', () => ({
  listAuditEvents: (...args: unknown[]) => hoisted.listAuditEventsMock(...args),
}))

vi.mock('@/lib/server/domains/authz/role.service', () => ({
  revokeRoleAssignment: (...args: unknown[]) => hoisted.revokeRoleAssignmentMock(...args),
}))

import { Route as AuditEventsRoute } from '../audit-events/index'
import { Route as PermissionsRoute } from '../permissions'
import { Route as RoleAssignmentRoute } from '../role-assignments/$assignmentId'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const auditHandlers = (AuditEventsRoute as unknown as RouteWithHandlers).options.server.handlers
const permissionHandlers = (PermissionsRoute as unknown as RouteWithHandlers).options.server
  .handlers
const roleAssignmentHandlers = (RoleAssignmentRoute as unknown as RouteWithHandlers).options.server
  .handlers

function args(
  params: Record<string, string> = {},
  request = new Request('http://test/api/v1/permissions')
) {
  return { request, params }
}

async function json(response: Response) {
  return response.json() as Promise<{ data?: unknown; error?: unknown }>
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: 'principal_admin',
    role: 'team',
    key: { scopes: [] },
  })
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.hasPermissionMock.mockReturnValue(true)
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
  hoisted.listAuditEventsMock.mockResolvedValue({
    items: [{ id: 'audit_evt_1', action: 'ticket.created' }],
    nextCursor: 'cursor_next',
    hasMore: true,
  })
  hoisted.revokeRoleAssignmentMock.mockResolvedValue(undefined)
})

describe('GET /api/v1/audit-events', () => {
  it('lists audit events after scope and permission checks with parsed filters', async () => {
    const response = await auditHandlers.GET(
      args(
        {},
        new Request(
          'http://test/api/v1/audit-events?principalId=principal_1&action=ticket.created&actionPrefix=ticket.&targetType=ticket&targetId=ticket_1&source=mcp&from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z&cursor=abc&limit=50'
        )
      )
    )

    expect(response.status).toBe(200)
    expect((await json(response)).data).toEqual({
      items: [{ id: 'audit_evt_1', action: 'ticket.created' }],
      nextCursor: 'cursor_next',
      hasMore: true,
    })
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.AUDIT_VIEW
    )
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith('principal_admin')
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(expect.any(Set), PERMISSIONS.AUDIT_VIEW)
    expect(hoisted.listAuditEventsMock).toHaveBeenCalledWith({
      principalId: 'principal_1',
      action: 'ticket.created',
      actionPrefix: 'ticket.',
      targetType: 'ticket',
      targetId: 'ticket_1',
      source: 'mcp',
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-02T00:00:00.000Z'),
      cursor: 'abc',
      limit: 50,
    })
  })

  it('lists audit events with omitted optional date filters as undefined', async () => {
    const response = await auditHandlers.GET(
      args({}, new Request('http://test/api/v1/audit-events'))
    )

    expect(response.status).toBe(200)
    expect(hoisted.listAuditEventsMock).toHaveBeenCalledWith({
      principalId: undefined,
      action: undefined,
      actionPrefix: undefined,
      targetType: undefined,
      targetId: undefined,
      source: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
      limit: undefined,
    })
  })

  it('rejects invalid query params and denies missing audit.view permission before listing', async () => {
    const invalid = await auditHandlers.GET(
      args({}, new Request('http://test/api/v1/audit-events?source=browser&limit=500'))
    )
    expect(invalid.status).toBe(400)
    expect(hoisted.listAuditEventsMock).not.toHaveBeenCalled()

    vi.clearAllMocks()
    hoisted.withApiKeyAuthMock.mockResolvedValue({ principalId: 'principal_admin', role: 'team' })
    hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
    hoisted.hasPermissionMock.mockReturnValue(false)
    const denied = await auditHandlers.GET(args({}, new Request('http://test/api/v1/audit-events')))
    expect(denied.status).toBe(403)
    expect(hoisted.listAuditEventsMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/permissions', () => {
  it('returns permission catalogue and categories after admin.manage_roles checks', async () => {
    const response = await permissionHandlers.GET(args())

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.data).toEqual({
      permissions: expect.arrayContaining([PERMISSIONS.ADMIN_MANAGE_ROLES]),
      categories: expect.objectContaining({
        admin: expect.arrayContaining([PERMISSIONS.ADMIN_MANAGE_ROLES]),
      }),
    })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_ROLES
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.ADMIN_MANAGE_ROLES
    )
  })

  it('returns 403 when the caller lacks admin.manage_roles', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await permissionHandlers.GET(args())

    expect(response.status).toBe(403)
  })
})

describe('DELETE /api/v1/role-assignments/:assignmentId', () => {
  it('revokes a role assignment after admin.manage_roles checks', async () => {
    hoisted.parseTypeIdMock.mockReturnValue('role_asgn_123')

    const response = await roleAssignmentHandlers.DELETE(
      args(
        { assignmentId: 'role_asgn_123' },
        new Request('http://test/api/v1/role-assignments/role_asgn_123', { method: 'DELETE' })
      )
    )

    expect(response.status).toBe(204)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(
      'role_asgn_123',
      'role_asgn',
      'role assignment ID'
    )
    expect(hoisted.revokeRoleAssignmentMock).toHaveBeenCalledWith({
      assignmentId: 'role_asgn_123',
      actorPrincipalId: 'principal_admin',
    })
  })

  it('returns 403 before revocation when the caller lacks admin.manage_roles', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await roleAssignmentHandlers.DELETE(
      args(
        { assignmentId: 'role_asgn_123' },
        new Request('http://test/api/v1/role-assignments/role_asgn_123', { method: 'DELETE' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.revokeRoleAssignmentMock).not.toHaveBeenCalled()
  })
})
