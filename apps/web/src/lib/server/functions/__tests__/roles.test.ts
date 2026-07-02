import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockListRoles: vi.fn(),
  mockGetRoleWithPermissions: vi.fn(),
  mockCreateRole: vi.fn(),
  mockUpdateRole: vi.fn(),
  mockDeleteRole: vi.fn(),
  mockSetRolePermissions: vi.fn(),
  mockListAssignmentsForPrincipal: vi.fn(),
  mockAssignRole: vi.fn(),
  mockRevokeRoleAssignment: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.mockRequireAuth(...args),
}))

vi.mock('@/lib/server/domains/authz/role.service', () => ({
  listRoles: (...args: unknown[]) => hoisted.mockListRoles(...args),
  getRoleWithPermissions: (...args: unknown[]) => hoisted.mockGetRoleWithPermissions(...args),
  createRole: (...args: unknown[]) => hoisted.mockCreateRole(...args),
  updateRole: (...args: unknown[]) => hoisted.mockUpdateRole(...args),
  deleteRole: (...args: unknown[]) => hoisted.mockDeleteRole(...args),
  setRolePermissions: (...args: unknown[]) => hoisted.mockSetRolePermissions(...args),
  listAssignmentsForPrincipal: (...args: unknown[]) =>
    hoisted.mockListAssignmentsForPrincipal(...args),
  assignRole: (...args: unknown[]) => hoisted.mockAssignRole(...args),
  revokeRoleAssignment: (...args: unknown[]) => hoisted.mockRevokeRoleAssignment(...args),
}))

await import('../roles')

const [
  listRolesFn,
  getRoleFn,
  createRoleFn,
  updateRoleFn,
  deleteRoleFn,
  setRolePermissionsFn,
  listAssignmentsForPrincipalFn,
  assignRoleFn,
  revokeRoleAssignmentFn,
] = handlersByIndex

if (!revokeRoleAssignmentFn) {
  throw new Error(`role handlers were not registered; found ${handlersByIndex.length}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    principal: { id: 'principal_admin' },
  })
  hoisted.mockListRoles.mockResolvedValue([{ id: 'role_admin', key: 'admin' }])
  hoisted.mockGetRoleWithPermissions.mockResolvedValue({
    id: 'role_admin',
    key: 'admin',
    permissions: [PERMISSIONS.ADMIN_MANAGE_ROLES],
  })
  hoisted.mockCreateRole.mockResolvedValue('role_custom')
  hoisted.mockUpdateRole.mockResolvedValue(undefined)
  hoisted.mockDeleteRole.mockResolvedValue(undefined)
  hoisted.mockSetRolePermissions.mockResolvedValue(undefined)
  hoisted.mockListAssignmentsForPrincipal.mockResolvedValue([{ id: 'role_asgn_1' }])
  hoisted.mockAssignRole.mockResolvedValue('role_asgn_2')
  hoisted.mockRevokeRoleAssignment.mockResolvedValue(undefined)
})

describe('role server functions', () => {
  it('lists and fetches roles after admin auth', async () => {
    await expect(listRolesFn({ data: {} })).resolves.toEqual([{ id: 'role_admin', key: 'admin' }])
    await expect(getRoleFn({ data: { id: 'role_admin' } })).resolves.toEqual({
      id: 'role_admin',
      key: 'admin',
      permissions: [PERMISSIONS.ADMIN_MANAGE_ROLES],
    })

    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith({ roles: ['admin'] })
    expect(hoisted.mockGetRoleWithPermissions).toHaveBeenCalledWith('role_admin')
  })

  it('creates, updates, deletes, and mutates role permissions with actor principal context', async () => {
    await expect(
      createRoleFn({
        data: {
          key: 'support_lead',
          name: 'Support lead',
          description: undefined,
          permissionKeys: [PERMISSIONS.TICKET_VIEW_TEAM],
        },
      })
    ).resolves.toEqual({ id: 'role_custom' })
    expect(hoisted.mockCreateRole).toHaveBeenCalledWith({
      key: 'support_lead',
      name: 'Support lead',
      description: null,
      permissionKeys: [PERMISSIONS.TICKET_VIEW_TEAM],
      actorPrincipalId: 'principal_admin',
    })

    await expect(
      updateRoleFn({
        data: { id: 'role_custom', name: 'Support lead', description: 'Can triage tickets' },
      })
    ).resolves.toEqual({ ok: true })
    expect(hoisted.mockUpdateRole).toHaveBeenCalledWith({
      id: 'role_custom',
      name: 'Support lead',
      description: 'Can triage tickets',
      actorPrincipalId: 'principal_admin',
    })

    await expect(deleteRoleFn({ data: { id: 'role_custom' } })).resolves.toEqual({ ok: true })
    expect(hoisted.mockDeleteRole).toHaveBeenCalledWith({
      id: 'role_custom',
      actorPrincipalId: 'principal_admin',
    })

    await expect(
      setRolePermissionsFn({
        data: { roleId: 'role_custom', permissionKeys: [PERMISSIONS.TICKET_VIEW_TEAM] },
      })
    ).resolves.toEqual({ ok: true })
    expect(hoisted.mockSetRolePermissions).toHaveBeenCalledWith({
      roleId: 'role_custom',
      permissionKeys: [PERMISSIONS.TICKET_VIEW_TEAM],
      actorPrincipalId: 'principal_admin',
    })
  })

  it('lists, assigns, and revokes principal role assignments', async () => {
    await expect(
      listAssignmentsForPrincipalFn({ data: { principalId: 'principal_agent' } })
    ).resolves.toEqual([{ id: 'role_asgn_1' }])
    expect(hoisted.mockListAssignmentsForPrincipal).toHaveBeenCalledWith('principal_agent')

    await expect(
      assignRoleFn({
        data: { principalId: 'principal_agent', roleId: 'role_custom', teamId: undefined },
      })
    ).resolves.toEqual({ id: 'role_asgn_2' })
    expect(hoisted.mockAssignRole).toHaveBeenCalledWith({
      principalId: 'principal_agent',
      roleId: 'role_custom',
      teamId: null,
      actorPrincipalId: 'principal_admin',
    })

    await expect(
      revokeRoleAssignmentFn({ data: { assignmentId: 'role_asgn_2' } })
    ).resolves.toEqual({ ok: true })
    expect(hoisted.mockRevokeRoleAssignment).toHaveBeenCalledWith({
      assignmentId: 'role_asgn_2',
      actorPrincipalId: 'principal_admin',
    })
  })

  it('does not call role services when admin auth fails', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('admin required'))

    await expect(listRolesFn({ data: {} })).rejects.toThrow('admin required')

    expect(hoisted.mockListRoles).not.toHaveBeenCalled()
  })
})
