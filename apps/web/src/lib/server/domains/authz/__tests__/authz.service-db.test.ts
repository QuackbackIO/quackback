import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, TeamId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  mockTeamMembershipsFindMany: vi.fn(),
  mockPrincipalRoleAssignmentsFindMany: vi.fn(),
  mockPrincipalFindFirst: vi.fn(),
  mockSelect: vi.fn(),
  mockEq: vi.fn(),
  mockInArray: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      teamMemberships: {
        findMany: (...args: unknown[]) => hoisted.mockTeamMembershipsFindMany(...args),
      },
      principalRoleAssignments: {
        findMany: (...args: unknown[]) => hoisted.mockPrincipalRoleAssignmentsFindMany(...args),
      },
      principal: {
        findFirst: (...args: unknown[]) => hoisted.mockPrincipalFindFirst(...args),
      },
    },
    select: (...args: unknown[]) => hoisted.mockSelect(...args),
  },
  principal: {
    id: 'principal.id',
  },
  principalRoleAssignments: {
    principalId: 'principalRoleAssignments.principalId',
  },
  rolePermissions: {
    roleId: 'rolePermissions.roleId',
    permissionId: 'rolePermissions.permissionId',
  },
  permissions: {
    id: 'permissions.id',
    key: 'permissions.key',
  },
  teamMemberships: {
    principalId: 'teamMemberships.principalId',
  },
  eq: (...args: unknown[]) => hoisted.mockEq(...args),
  inArray: (...args: unknown[]) => hoisted.mockInArray(...args),
}))

const { assertPermission, loadPermissionSet } = await import('../authz.service')
const { PERMISSIONS } = await import('../authz.permissions')

type SelectChain = {
  from: ReturnType<typeof vi.fn>
  innerJoin: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  then: Promise<unknown[]>['then']
  catch: Promise<unknown[]>['catch']
  finally: Promise<unknown[]>['finally']
}

function makeSelectChain(rows: unknown[]): SelectChain {
  const promise = Promise.resolve(rows)
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  } as SelectChain
  return chain
}

const PRINCIPAL = 'principal_authz' as PrincipalId
const TEAM_A = 'team_a' as TeamId
const TEAM_B = 'team_b' as TeamId

beforeEach(() => {
  hoisted.mockTeamMembershipsFindMany.mockReset()
  hoisted.mockPrincipalRoleAssignmentsFindMany.mockReset()
  hoisted.mockPrincipalFindFirst.mockReset()
  hoisted.mockSelect.mockReset()
  hoisted.mockEq.mockReset()
  hoisted.mockInArray.mockReset()
  hoisted.mockEq.mockImplementation((...args: unknown[]) => ['eq', ...args])
  hoisted.mockInArray.mockImplementation((...args: unknown[]) => ['inArray', ...args])
  hoisted.mockTeamMembershipsFindMany.mockResolvedValue([])
})

describe('loadPermissionSet', () => {
  it('builds workspace and team-scoped grants from role assignments', async () => {
    hoisted.mockTeamMembershipsFindMany.mockResolvedValue([{ teamId: TEAM_A }, { teamId: TEAM_B }])
    hoisted.mockPrincipalRoleAssignmentsFindMany.mockResolvedValue([
      { roleId: 'role_workspace', teamId: null },
      { roleId: 'role_team', teamId: TEAM_A },
      { roleId: 'role_empty', teamId: TEAM_B },
      { roleId: 'role_team', teamId: TEAM_A },
    ])
    hoisted.mockSelect.mockReturnValueOnce(
      makeSelectChain([
        { roleId: 'role_workspace', key: PERMISSIONS.TICKET_VIEW_ALL },
        { roleId: 'role_team', key: PERMISSIONS.TICKET_REPLY_PUBLIC },
        { roleId: 'role_team', key: PERMISSIONS.TICKET_COMMENT_INTERNAL },
      ])
    )

    const set = await loadPermissionSet(PRINCIPAL)

    expect(set.principalId).toBe(PRINCIPAL)
    expect(set.teamIds).toEqual([TEAM_A, TEAM_B])
    expect([...set.workspacePermissions]).toEqual([PERMISSIONS.TICKET_VIEW_ALL])
    expect([...(set.teamPermissions.get(TEAM_A) ?? [])]).toEqual([
      PERMISSIONS.TICKET_REPLY_PUBLIC,
      PERMISSIONS.TICKET_COMMENT_INTERNAL,
    ])
    expect([...(set.teamPermissions.get(TEAM_B) ?? [])]).toEqual([])
    expect(hoisted.mockInArray).toHaveBeenCalledWith('rolePermissions.roleId', [
      'role_workspace',
      'role_team',
      'role_empty',
    ])
  })

  it('falls back to legacy admin, member, and customer role mappings when no assignments exist', async () => {
    hoisted.mockPrincipalRoleAssignmentsFindMany.mockResolvedValue([])
    hoisted.mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'admin' })
    let set = await loadPermissionSet(PRINCIPAL)
    expect(set.workspacePermissions.has(PERMISSIONS.TICKET_VIEW_TEAM)).toBe(true)

    hoisted.mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'member' })
    set = await loadPermissionSet(PRINCIPAL)
    expect(set.workspacePermissions.has(PERMISSIONS.TICKET_REPLY_PUBLIC)).toBe(true)
    expect(set.workspacePermissions.has(PERMISSIONS.TICKET_VIEW_ALL)).toBe(false)

    hoisted.mockPrincipalFindFirst.mockResolvedValueOnce(undefined)
    set = await loadPermissionSet(PRINCIPAL)
    expect(set.workspacePermissions.size).toBe(0)
  })
})

describe('assertPermission', () => {
  it('allows matching permissions and throws a structured error when missing', () => {
    const set = {
      principalId: PRINCIPAL,
      workspacePermissions: new Set([PERMISSIONS.TICKET_VIEW_ALL]),
      teamPermissions: new Map([[TEAM_A, new Set([PERMISSIONS.TICKET_REPLY_PUBLIC])]]),
      teamIds: [TEAM_A],
    }

    expect(() => assertPermission(set, PERMISSIONS.TICKET_VIEW_ALL)).not.toThrow()
    expect(() =>
      assertPermission(set, PERMISSIONS.TICKET_REPLY_PUBLIC, { primaryTeamId: TEAM_A })
    ).not.toThrow()
    expect(() =>
      assertPermission(set, PERMISSIONS.TICKET_REPLY_PUBLIC, { primaryTeamId: TEAM_B })
    ).toThrow(/Missing required permission/)
  })
})
