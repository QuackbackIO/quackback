import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listAssignmentsForPrincipalMock: vi.fn(),
  assignRoleMock: vi.fn(),
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
  listAssignmentsForPrincipal: (...args: unknown[]) =>
    hoisted.listAssignmentsForPrincipalMock(...args),
  assignRole: (...args: unknown[]) => hoisted.assignRoleMock(...args),
}))

import { Route } from '../$principalId.roles'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const handlers = (Route as unknown as RouteWithHandlers).options.server.handlers

const PRINCIPAL = 'principal_target'
const ACTOR = 'principal_admin'
const ROLE = 'role_agent'

function jsonRequest(body?: unknown) {
  return new Request('http://test/api/v1/principals/principal_target/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(request = new Request('http://test/api/v1/principals/principal_target/roles')) {
  return { request, params: { principalId: PRINCIPAL } }
}

async function data(response: Response) {
  return ((await response.json()) as { data: unknown }).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({ principalId: ACTOR, role: 'team' })
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.hasPermissionMock.mockReturnValue(true)
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
  hoisted.listAssignmentsForPrincipalMock.mockResolvedValue([
    { id: 'role_asgn_1', principalId: PRINCIPAL, roleId: ROLE },
  ])
  hoisted.assignRoleMock.mockResolvedValue('role_asgn_2')
})

describe('/api/v1/principals/:principalId/roles', () => {
  it('lists role assignments after admin.manage_roles checks', async () => {
    const response = await handlers.GET(args())

    expect(response.status).toBe(200)
    expect(await data(response)).toEqual([
      { id: 'role_asgn_1', principalId: PRINCIPAL, roleId: ROLE },
    ])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_ROLES
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.ADMIN_MANAGE_ROLES
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(PRINCIPAL, 'principal', 'principal ID')
    expect(hoisted.listAssignmentsForPrincipalMock).toHaveBeenCalledWith(PRINCIPAL)
  })

  it('assigns a scoped role and returns the assignment id', async () => {
    const response = await handlers.POST(
      args(jsonRequest({ roleId: ROLE, teamId: 'team_support' }))
    )

    expect(response.status).toBe(201)
    expect(await data(response)).toEqual({
      id: 'role_asgn_2',
      principalId: PRINCIPAL,
      roleId: ROLE,
    })
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(ROLE, 'role', 'role ID')
    expect(hoisted.assignRoleMock).toHaveBeenCalledWith({
      principalId: PRINCIPAL,
      roleId: ROLE,
      teamId: 'team_support',
      actorPrincipalId: ACTOR,
    })
  })

  it('normalizes missing teamId to null when assigning', async () => {
    await handlers.POST(args(jsonRequest({ roleId: ROLE })))

    expect(hoisted.assignRoleMock).toHaveBeenCalledWith({
      principalId: PRINCIPAL,
      roleId: ROLE,
      teamId: null,
      actorPrincipalId: ACTOR,
    })
  })

  it('rejects invalid bodies and permission-denied callers before mutating', async () => {
    const invalid = await handlers.POST(args(jsonRequest({ teamId: 'team_support' })))
    expect(invalid.status).toBe(400)
    expect(hoisted.assignRoleMock).not.toHaveBeenCalled()

    vi.clearAllMocks()
    hoisted.withApiKeyAuthMock.mockResolvedValue({ principalId: ACTOR, role: 'team' })
    hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
    hoisted.hasPermissionMock.mockReturnValue(false)

    const getDenied = await handlers.GET(args())
    expect(getDenied.status).toBe(403)
    const postDenied = await handlers.POST(args(jsonRequest({ roleId: ROLE })))
    expect(postDenied.status).toBe(403)
    expect(hoisted.listAssignmentsForPrincipalMock).not.toHaveBeenCalled()
    expect(hoisted.assignRoleMock).not.toHaveBeenCalled()
  })
})
