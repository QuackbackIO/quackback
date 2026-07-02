import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { NotFoundError } from '@/lib/shared/errors'

// All role route handlers dynamically import the role.service module, so we mock
// that module (along with auth, authz, and validation) and assert behaviour at
// the request level. Mirrors the canonical inboxes route test structure.
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listRolesMock: vi.fn(),
  createRoleMock: vi.fn(),
  updateRoleMock: vi.fn(),
  deleteRoleMock: vi.fn(),
  setRolePermissionsMock: vi.fn(),
  getRoleWithPermissionsMock: vi.fn(),
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

vi.mock('@/lib/server/domains/authz/role.service', () => ({
  listRoles: (...args: unknown[]) => hoisted.listRolesMock(...args),
  createRole: (...args: unknown[]) => hoisted.createRoleMock(...args),
  updateRole: (...args: unknown[]) => hoisted.updateRoleMock(...args),
  deleteRole: (...args: unknown[]) => hoisted.deleteRoleMock(...args),
  setRolePermissions: (...args: unknown[]) => hoisted.setRolePermissionsMock(...args),
  getRoleWithPermissions: (...args: unknown[]) => hoisted.getRoleWithPermissionsMock(...args),
}))

import { Route as RolesRoute } from '../index'
import { Route as RoleDetailRoute } from '../$roleId'
import { Route as RolePermissionsRoute } from '../$roleId.permissions'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const rolesHandlers = (RolesRoute as unknown as RouteWithHandlers).options.server.handlers
const roleDetailHandlers = (RoleDetailRoute as unknown as RouteWithHandlers).options.server.handlers
const rolePermissionsHandlers = (RolePermissionsRoute as unknown as RouteWithHandlers).options
  .server.handlers

const PRINCIPAL = 'principal_admin'
const ROLE = 'role_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/roles')
) {
  return { request, params: handlerParams }
}

function role(overrides: Record<string, unknown> = {}) {
  return {
    id: ROLE,
    key: 'support-lead',
    name: 'Support Lead',
    description: 'Leads the support team',
    isSystem: false,
    permissions: ['ticket.view_all'],
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

describe('/api/v1/roles index routes', () => {
  it('lists roles after scope and permission checks', async () => {
    const rows = [role()]
    hoisted.listRolesMock.mockResolvedValue(rows)

    const response = await rolesHandlers.GET(args())
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(rows)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_ROLES
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.ADMIN_MANAGE_ROLES
    )
    expect(hoisted.listRolesMock).toHaveBeenCalledWith()
  })

  it('denies listing roles with 403 when permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await rolesHandlers.GET(args())
    expect(response.status).toBe(403)
    expect(hoisted.listRolesMock).not.toHaveBeenCalled()
  })

  it('maps a domain error from listRoles through handleDomainError', async () => {
    hoisted.listRolesMock.mockRejectedValue(new NotFoundError('ROLE_NOT_FOUND', 'Role not found'))

    const response = await rolesHandlers.GET(args())
    expect(response.status).toBe(404)
  })

  it('creates a role and returns the created resource', async () => {
    hoisted.createRoleMock.mockResolvedValue(ROLE)
    const created = role()
    hoisted.getRoleWithPermissionsMock.mockResolvedValue(created)

    const response = await rolesHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/roles', 'POST', {
          key: 'support-lead',
          name: 'Support Lead',
          description: 'Leads the support team',
          permissionKeys: ['ticket.view_all'],
        })
      )
    )
    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(created)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_ROLES
    )
    expect(hoisted.createRoleMock).toHaveBeenCalledWith({
      key: 'support-lead',
      name: 'Support Lead',
      description: 'Leads the support team',
      permissionKeys: ['ticket.view_all'],
      actorPrincipalId: PRINCIPAL,
    })
    expect(hoisted.getRoleWithPermissionsMock).toHaveBeenCalledWith(ROLE)
  })

  it('creates a role with the schema default for omitted permissionKeys', async () => {
    hoisted.createRoleMock.mockResolvedValue(ROLE)
    hoisted.getRoleWithPermissionsMock.mockResolvedValue(role({ permissions: [] }))

    const response = await rolesHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/roles', 'POST', {
          key: 'support-lead',
          name: 'Support Lead',
        })
      )
    )
    expect(response.status).toBe(201)
    expect(hoisted.createRoleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'support-lead',
        name: 'Support Lead',
        description: undefined,
        permissionKeys: [],
        actorPrincipalId: PRINCIPAL,
      })
    )
  })

  it('denies creating a role with 403 when permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await rolesHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/roles', 'POST', { key: 'k', name: 'n' }))
    )
    expect(response.status).toBe(403)
    expect(hoisted.createRoleMock).not.toHaveBeenCalled()
  })

  it('rejects invalid create body with 400 and a non-parsable body', async () => {
    // Invalid: empty key fails z.string().min(1)
    const invalidResponse = await rolesHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/roles', 'POST', { key: '', name: 'n' }))
    )
    expect(invalidResponse.status).toBe(400)

    // Non-JSON body: request.json() throws → .catch(() => null) → safeParse(null) fails
    const nonJsonResponse = await rolesHandlers.POST(
      args(
        {},
        new Request('http://test/api/v1/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        })
      )
    )
    expect(nonJsonResponse.status).toBe(400)
    expect(hoisted.createRoleMock).not.toHaveBeenCalled()
  })

  it('maps a domain error from createRole through handleDomainError', async () => {
    hoisted.createRoleMock.mockRejectedValue(new NotFoundError('ROLE_NOT_FOUND', 'Role not found'))

    const response = await rolesHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/roles', 'POST', { key: 'k', name: 'n' }))
    )
    expect(response.status).toBe(404)
  })
})

describe('/api/v1/roles/$roleId routes', () => {
  it('fetches a role with its permissions', async () => {
    const row = role()
    hoisted.getRoleWithPermissionsMock.mockResolvedValue(row)

    const response = await roleDetailHandlers.GET(args({ roleId: ROLE }))
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(ROLE, 'role', 'role ID')
    expect(hoisted.getRoleWithPermissionsMock).toHaveBeenCalledWith(ROLE)
  })

  it('returns 404 when fetching a missing role', async () => {
    hoisted.getRoleWithPermissionsMock.mockRejectedValue(
      new NotFoundError('ROLE_NOT_FOUND', 'Role not found')
    )

    const response = await roleDetailHandlers.GET(args({ roleId: ROLE }))
    expect(response.status).toBe(404)
  })

  it('denies fetching a role with 403 when permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await roleDetailHandlers.GET(args({ roleId: ROLE }))
    expect(response.status).toBe(403)
    expect(hoisted.getRoleWithPermissionsMock).not.toHaveBeenCalled()
  })

  it('patches a role and returns the refreshed resource', async () => {
    hoisted.updateRoleMock.mockResolvedValue(undefined)
    const updated = role({ name: 'Renamed role' })
    hoisted.getRoleWithPermissionsMock.mockResolvedValue(updated)

    const response = await roleDetailHandlers.PATCH(
      args(
        { roleId: ROLE },
        jsonRequest('http://test/api/v1/roles/role_123', 'PATCH', {
          name: 'Renamed role',
          description: 'New description',
        })
      )
    )
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(updated)
    expect(hoisted.updateRoleMock).toHaveBeenCalledWith({
      id: ROLE,
      name: 'Renamed role',
      description: 'New description',
      actorPrincipalId: PRINCIPAL,
    })
    expect(hoisted.getRoleWithPermissionsMock).toHaveBeenCalledWith(ROLE)
  })

  it('returns 404 when patching a missing role', async () => {
    hoisted.updateRoleMock.mockRejectedValue(new NotFoundError('ROLE_NOT_FOUND', 'Role not found'))

    const response = await roleDetailHandlers.PATCH(
      args(
        { roleId: ROLE },
        jsonRequest('http://test/api/v1/roles/role_123', 'PATCH', { name: 'Renamed role' })
      )
    )
    expect(response.status).toBe(404)
  })

  it('denies patching a role with 403 when permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await roleDetailHandlers.PATCH(
      args(
        { roleId: ROLE },
        jsonRequest('http://test/api/v1/roles/role_123', 'PATCH', { name: 'Renamed role' })
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.updateRoleMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid patch body with 400 and a non-parsable body', async () => {
    // Invalid: empty name fails z.string().min(1)
    const invalidResponse = await roleDetailHandlers.PATCH(
      args(
        { roleId: ROLE },
        jsonRequest('http://test/api/v1/roles/role_123', 'PATCH', { name: '' })
      )
    )
    expect(invalidResponse.status).toBe(400)

    // Non-JSON body: request.json() throws → .catch(() => null) → safeParse(null) fails
    const nonJsonResponse = await roleDetailHandlers.PATCH(
      args(
        { roleId: ROLE },
        new Request('http://test/api/v1/roles/role_123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        })
      )
    )
    expect(nonJsonResponse.status).toBe(400)
    expect(hoisted.updateRoleMock).not.toHaveBeenCalled()
  })

  it('deletes a custom role and returns no content', async () => {
    hoisted.deleteRoleMock.mockResolvedValue(undefined)

    const response = await roleDetailHandlers.DELETE(args({ roleId: ROLE }))
    expect(response.status).toBe(204)
    expect(hoisted.deleteRoleMock).toHaveBeenCalledWith({
      id: ROLE,
      actorPrincipalId: PRINCIPAL,
    })
  })

  it('returns 404 when deleting a missing role', async () => {
    hoisted.deleteRoleMock.mockRejectedValue(new NotFoundError('ROLE_NOT_FOUND', 'Role not found'))

    const response = await roleDetailHandlers.DELETE(args({ roleId: ROLE }))
    expect(response.status).toBe(404)
  })

  it('denies deleting a role with 403 when permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await roleDetailHandlers.DELETE(args({ roleId: ROLE }))
    expect(response.status).toBe(403)
    expect(hoisted.deleteRoleMock).not.toHaveBeenCalled()
  })
})

describe('/api/v1/roles/$roleId/permissions routes', () => {
  it('replaces a role permission set and returns the refreshed resource', async () => {
    hoisted.setRolePermissionsMock.mockResolvedValue(undefined)
    const updated = role({ permissions: ['ticket.view_all', 'ticket.edit'] })
    hoisted.getRoleWithPermissionsMock.mockResolvedValue(updated)

    const response = await rolePermissionsHandlers.PUT(
      args(
        { roleId: ROLE },
        jsonRequest('http://test/api/v1/roles/role_123/permissions', 'PUT', {
          permissionKeys: ['ticket.view_all', 'ticket.edit'],
        })
      )
    )
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(updated)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_ROLES
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(ROLE, 'role', 'role ID')
    expect(hoisted.setRolePermissionsMock).toHaveBeenCalledWith({
      roleId: ROLE,
      permissionKeys: ['ticket.view_all', 'ticket.edit'],
      actorPrincipalId: PRINCIPAL,
    })
    expect(hoisted.getRoleWithPermissionsMock).toHaveBeenCalledWith(ROLE)
  })

  it('replaces a role permission set with an empty array', async () => {
    hoisted.setRolePermissionsMock.mockResolvedValue(undefined)
    hoisted.getRoleWithPermissionsMock.mockResolvedValue(role({ permissions: [] }))

    const response = await rolePermissionsHandlers.PUT(
      args(
        { roleId: ROLE },
        jsonRequest('http://test/api/v1/roles/role_123/permissions', 'PUT', {
          permissionKeys: [],
        })
      )
    )
    expect(response.status).toBe(200)
    expect(hoisted.setRolePermissionsMock).toHaveBeenCalledWith({
      roleId: ROLE,
      permissionKeys: [],
      actorPrincipalId: PRINCIPAL,
    })
  })

  it('denies replacing permissions with 403 when permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await rolePermissionsHandlers.PUT(
      args(
        { roleId: ROLE },
        jsonRequest('http://test/api/v1/roles/role_123/permissions', 'PUT', {
          permissionKeys: [],
        })
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.setRolePermissionsMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid permissions body with 400 and a non-parsable body', async () => {
    // Invalid: permissionKeys must be an array
    const invalidResponse = await rolePermissionsHandlers.PUT(
      args(
        { roleId: ROLE },
        jsonRequest('http://test/api/v1/roles/role_123/permissions', 'PUT', {
          permissionKeys: 'not-an-array',
        })
      )
    )
    expect(invalidResponse.status).toBe(400)

    // Non-JSON body: request.json() throws → .catch(() => null) → safeParse(null) fails
    const nonJsonResponse = await rolePermissionsHandlers.PUT(
      args(
        { roleId: ROLE },
        new Request('http://test/api/v1/roles/role_123/permissions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        })
      )
    )
    expect(nonJsonResponse.status).toBe(400)
    expect(hoisted.setRolePermissionsMock).not.toHaveBeenCalled()
  })

  it('returns 404 when setting permissions on a missing role', async () => {
    hoisted.setRolePermissionsMock.mockRejectedValue(
      new NotFoundError('ROLE_NOT_FOUND', 'Role not found')
    )

    const response = await rolePermissionsHandlers.PUT(
      args(
        { roleId: ROLE },
        jsonRequest('http://test/api/v1/roles/role_123/permissions', 'PUT', {
          permissionKeys: [],
        })
      )
    )
    expect(response.status).toBe(404)
  })
})
