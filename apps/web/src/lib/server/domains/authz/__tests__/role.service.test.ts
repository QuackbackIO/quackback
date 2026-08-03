/**
 * role.service — authorization guardrails for the custom-roles admin surface.
 *
 * These are security-critical invariants: built-in (system) roles must be
 * tamper-proof, unknown permission keys must be rejected, roles in use must not
 * be deletable out from under their assignments, and every mutation must emit
 * an audit event. The DB layer is mocked (the lazy `db` Proxy is overridden);
 * assertions focus on the decision/branch behaviour and the audit side-effects,
 * not on SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/shared/errors'

// All state referenced by vi.mock factories must be hoisted (factories run at
// import time, before plain top-level consts initialize).
const h = vi.hoisted(() => {
  const state = {
    // FIFO queue of rows each `db.select(...)` chain resolves to, in call order.
    selectResults: [] as unknown[][],
    insertReturning: [] as unknown[],
  }
  const recordEventMock = vi.fn()
  function makeSelectChain() {
    const result = state.selectResults.shift() ?? []
    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.from = self
    chain.where = self
    chain.innerJoin = self
    chain.leftJoin = self
    chain.orderBy = self
    chain.groupBy = () => Promise.resolve(result)
    chain.limit = () => Promise.resolve(result)
    // Awaiting the chain directly (no .limit/.groupBy) also resolves to result.
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
    return chain
  }
  const writeOk = { where: () => Promise.resolve(undefined) }
  const insertChain = {
    values: () => ({ returning: () => Promise.resolve(state.insertReturning) }),
  }
  const dbMock = {
    select: () => makeSelectChain(),
    update: () => ({ set: () => writeOk }),
    delete: () => writeOk,
    insert: () => insertChain,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: () => insertChain, delete: () => writeOk, select: () => makeSelectChain() }),
  }
  return { state, recordEventMock, dbMock }
})

vi.mock('@/lib/server/domains/audit/audit.service', () => ({
  recordEvent: (...a: unknown[]) => h.recordEventMock(...a),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Real module gives the schema tables + drizzle operators (pure, ignored by
  // the mock chain); we override only the lazy `db` Proxy.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: h.dbMock,
}))

const recordEventMock = h.recordEventMock

import {
  listRoles,
  getRoleWithPermissions,
  createRole,
  updateRole,
  deleteRole,
  setRolePermissions,
  listAssignmentsForPrincipal,
  assignRole,
  revokeRoleAssignment,
} from '../role.service'
import type { RoleId, PrincipalId, RoleAssignmentId } from '@quackback/ids'
import { PERMISSIONS } from '../authz.permissions'

const ACTOR = 'principal_admin' as PrincipalId
const SYSTEM_ROLE = {
  id: 'role_admin',
  key: 'admin',
  name: 'Administrator',
  description: null,
  isSystem: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}
const CUSTOM_ROLE = {
  ...SYSTEM_ROLE,
  id: 'role_custom',
  key: 'support',
  name: 'Support',
  isSystem: false,
}

beforeEach(() => {
  h.state.selectResults = []
  h.state.insertReturning = []
  recordEventMock.mockReset()
})

describe('role.service — system-role protection (tamper-proof built-ins)', () => {
  it('updateRole rejects a system role with ForbiddenError and writes no audit', async () => {
    h.state.selectResults = [[SYSTEM_ROLE]] // role lookup
    await expect(
      updateRole({ id: 'role_admin' as RoleId, name: 'Hacked', actorPrincipalId: ACTOR })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(recordEventMock).not.toHaveBeenCalled()
  })

  it('deleteRole rejects a system role with ForbiddenError', async () => {
    h.state.selectResults = [[SYSTEM_ROLE]]
    await expect(
      deleteRole({ id: 'role_admin' as RoleId, actorPrincipalId: ACTOR })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(recordEventMock).not.toHaveBeenCalled()
  })

  it('setRolePermissions rejects a system role with ForbiddenError', async () => {
    h.state.selectResults = [[SYSTEM_ROLE]]
    await expect(
      setRolePermissions({
        roleId: 'role_admin' as RoleId,
        permissionKeys: [],
        actorPrincipalId: ACTOR,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(recordEventMock).not.toHaveBeenCalled()
  })
})

describe('role.service — not-found handling (default-deny on missing rows)', () => {
  it('getRoleWithPermissions throws NotFoundError when the role is absent', async () => {
    h.state.selectResults = [[]]
    await expect(getRoleWithPermissions('role_missing' as RoleId)).rejects.toBeInstanceOf(
      NotFoundError
    )
  })

  it('setRolePermissions throws NotFoundError when the role is absent', async () => {
    h.state.selectResults = [[]]
    await expect(
      setRolePermissions({
        roleId: 'role_missing' as RoleId,
        permissionKeys: [],
        actorPrincipalId: ACTOR,
      })
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('updateRole throws NotFoundError when the role is absent', async () => {
    h.state.selectResults = [[]]
    await expect(
      updateRole({ id: 'role_missing' as RoleId, name: 'X', actorPrincipalId: ACTOR })
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('revokeRoleAssignment throws NotFoundError when the assignment is absent', async () => {
    h.state.selectResults = [[]]
    await expect(
      revokeRoleAssignment({
        assignmentId: 'roleassign_missing' as RoleAssignmentId,
        actorPrincipalId: ACTOR,
      })
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(recordEventMock).not.toHaveBeenCalled()
  })
})

describe('role.service — conflict + validation guards', () => {
  it('createRole rejects a duplicate key with ConflictError (no audit)', async () => {
    h.state.selectResults = [[{ id: 'role_existing' }]] // key lookup finds an existing role
    await expect(
      createRole({
        key: 'support',
        name: 'Support',
        permissionKeys: [],
        actorPrincipalId: ACTOR,
      })
    ).rejects.toBeInstanceOf(ConflictError)
    expect(recordEventMock).not.toHaveBeenCalled()
  })

  it('createRole rejects an unknown permission key before touching the DB', async () => {
    await expect(
      createRole({
        key: 'support',
        name: 'Support',
        permissionKeys: ['totally.bogus.permission' as never],
        actorPrincipalId: ACTOR,
      })
    ).rejects.toBeInstanceOf(ConflictError)
    expect(recordEventMock).not.toHaveBeenCalled()
  })

  it('deleteRole refuses to delete a custom role that still has assignments', async () => {
    h.state.selectResults = [[CUSTOM_ROLE], [{ n: 3 }]] // role lookup, then assignment count
    await expect(
      deleteRole({ id: 'role_custom' as RoleId, actorPrincipalId: ACTOR })
    ).rejects.toBeInstanceOf(ConflictError)
    expect(recordEventMock).not.toHaveBeenCalled()
  })

  it('assignRole refuses a duplicate assignment for the same scope', async () => {
    h.state.selectResults = [[CUSTOM_ROLE], [{ id: 'roleassign_existing' }]] // role lookup, dup check
    await expect(
      assignRole({
        principalId: 'principal_user' as PrincipalId,
        roleId: 'role_custom' as RoleId,
        actorPrincipalId: ACTOR,
      })
    ).rejects.toBeInstanceOf(ConflictError)
    expect(recordEventMock).not.toHaveBeenCalled()
  })
})

describe('role.service — successful mutations record an audit event', () => {
  it('listRoles returns system roles first with permission and assignment counts', async () => {
    h.state.selectResults = [
      [SYSTEM_ROLE, CUSTOM_ROLE],
      [{ roleId: 'role_admin', n: 4 }],
      [{ roleId: 'role_custom', n: '2' }],
    ]

    const rows = await listRoles()

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'role_admin',
        key: 'admin',
        permissionCount: 4,
        assignmentCount: 0,
      }),
      expect.objectContaining({
        id: 'role_custom',
        key: 'support',
        permissionCount: 0,
        assignmentCount: 2,
      }),
    ])
  })

  it('listRoles returns an empty list without count queries when no roles exist', async () => {
    h.state.selectResults = [[]]

    await expect(listRoles()).resolves.toEqual([])
    expect(h.state.selectResults).toEqual([])
  })

  it('getRoleWithPermissions returns the role with permission keys', async () => {
    h.state.selectResults = [[CUSTOM_ROLE], [{ key: PERMISSIONS.TICKET_VIEW_TEAM }]]

    await expect(getRoleWithPermissions('role_custom' as RoleId)).resolves.toMatchObject({
      id: 'role_custom',
      key: 'support',
      permissionKeys: [PERMISSIONS.TICKET_VIEW_TEAM],
    })
  })

  it('createRole inserts and records role.created', async () => {
    h.state.selectResults = [[]] // key lookup: no existing role
    h.state.insertReturning = [{ id: 'role_new' }]
    const id = await createRole({
      key: 'triage',
      name: 'Triage',
      permissionKeys: [],
      actorPrincipalId: ACTOR,
    })
    expect(id).toBe('role_new')
    expect(recordEventMock).toHaveBeenCalledTimes(1)
    expect(recordEventMock.mock.calls[0][0]).toMatchObject({
      action: 'role.created',
      targetType: 'role',
      targetId: 'role_new',
      principalId: ACTOR,
    })
  })

  it('createRole stores permission grants when permission keys are provided', async () => {
    h.state.selectResults = [
      [],
      [{ id: 'perm_ticket_view_team', key: PERMISSIONS.TICKET_VIEW_TEAM }],
    ]
    h.state.insertReturning = [{ id: 'role_new' }]

    await expect(
      createRole({
        key: 'triage',
        name: 'Triage',
        description: 'Can triage tickets',
        permissionKeys: [PERMISSIONS.TICKET_VIEW_TEAM],
        actorPrincipalId: ACTOR,
      })
    ).resolves.toBe('role_new')

    expect(recordEventMock.mock.calls[0][0]).toMatchObject({
      action: 'role.created',
      diff: { after: { permissions: [PERMISSIONS.TICKET_VIEW_TEAM] } },
    })
  })

  it('createRole fails if the inserted role is not returned', async () => {
    h.state.selectResults = [[]]
    h.state.insertReturning = []

    await expect(
      createRole({
        key: 'triage',
        name: 'Triage',
        permissionKeys: [],
        actorPrincipalId: ACTOR,
      })
    ).rejects.toThrow('Failed to insert role')
  })

  it('updateRole on a custom role records role.updated with a before/after diff', async () => {
    h.state.selectResults = [[CUSTOM_ROLE]]
    await updateRole({ id: 'role_custom' as RoleId, name: 'Renamed', actorPrincipalId: ACTOR })
    expect(recordEventMock).toHaveBeenCalledTimes(1)
    const ev = recordEventMock.mock.calls[0][0]
    expect(ev).toMatchObject({ action: 'role.updated', targetId: 'role_custom' })
    expect(ev.diff.before.name).toBe('Support')
    expect(ev.diff.after.name).toBe('Renamed')
  })

  it('setRolePermissions replaces grants and records before/after permissions', async () => {
    h.state.selectResults = [
      [CUSTOM_ROLE],
      [{ key: PERMISSIONS.TICKET_VIEW_TEAM }],
      [{ id: 'perm_reply', key: PERMISSIONS.TICKET_REPLY_PUBLIC }],
    ]

    await setRolePermissions({
      roleId: 'role_custom' as RoleId,
      permissionKeys: [PERMISSIONS.TICKET_REPLY_PUBLIC],
      actorPrincipalId: ACTOR,
    })

    expect(recordEventMock.mock.calls[0][0]).toMatchObject({
      action: 'role.permissions_set',
      targetId: 'role_custom',
      diff: {
        before: { permissions: [PERMISSIONS.TICKET_VIEW_TEAM] },
        after: { permissions: [PERMISSIONS.TICKET_REPLY_PUBLIC] },
      },
    })
  })

  it('setRolePermissions reports permissions missing from the DB', async () => {
    h.state.selectResults = [[CUSTOM_ROLE], [], []]

    await expect(
      setRolePermissions({
        roleId: 'role_custom' as RoleId,
        permissionKeys: [PERMISSIONS.TICKET_REPLY_PUBLIC],
        actorPrincipalId: ACTOR,
      })
    ).rejects.toMatchObject({ code: 'PERMISSIONS_MISSING' })
    expect(recordEventMock).not.toHaveBeenCalled()
  })

  it('deleteRole removes an unassigned custom role and records role.deleted', async () => {
    h.state.selectResults = [[CUSTOM_ROLE], [{ n: 0 }]] // role lookup, zero assignments
    await deleteRole({ id: 'role_custom' as RoleId, actorPrincipalId: ACTOR })
    expect(recordEventMock).toHaveBeenCalledTimes(1)
    expect(recordEventMock.mock.calls[0][0]).toMatchObject({
      action: 'role.deleted',
      targetId: 'role_custom',
    })
  })

  it('assignRole grants a new assignment and records role_assignment.granted', async () => {
    h.state.selectResults = [[CUSTOM_ROLE], []] // role lookup, no existing dup
    h.state.insertReturning = [{ id: 'roleassign_new' }]
    const id = await assignRole({
      principalId: 'principal_user' as PrincipalId,
      roleId: 'role_custom' as RoleId,
      actorPrincipalId: ACTOR,
    })
    expect(id).toBe('roleassign_new')
    expect(recordEventMock.mock.calls[0][0]).toMatchObject({
      action: 'role_assignment.granted',
      targetType: 'principal',
      targetId: 'principal_user',
    })
  })

  it('assignRole grants team-scoped assignments and records the team scope', async () => {
    h.state.selectResults = [[CUSTOM_ROLE], []]
    h.state.insertReturning = [{ id: 'roleassign_team' }]

    const id = await assignRole({
      principalId: 'principal_user' as PrincipalId,
      roleId: 'role_custom' as RoleId,
      teamId: 'team_support' as never,
      actorPrincipalId: ACTOR,
    })

    expect(id).toBe('roleassign_team')
    expect(recordEventMock.mock.calls[0][0]).toMatchObject({
      action: 'role_assignment.granted',
      diff: { after: { role: 'support', teamId: 'team_support' } },
    })
  })

  it('assignRole fails if the inserted assignment is not returned', async () => {
    h.state.selectResults = [[CUSTOM_ROLE], []]
    h.state.insertReturning = []

    await expect(
      assignRole({
        principalId: 'principal_user' as PrincipalId,
        roleId: 'role_custom' as RoleId,
        actorPrincipalId: ACTOR,
      })
    ).rejects.toThrow('Failed to insert role assignment')
  })

  it('listAssignmentsForPrincipal hydrates role and optional team details', async () => {
    const createdAt = new Date('2026-01-02T00:00:00.000Z')
    h.state.selectResults = [
      [
        {
          id: 'roleassign_1',
          roleId: 'role_custom',
          roleKey: 'support',
          roleName: 'Support',
          roleIsSystem: false,
          teamId: 'team_support',
          teamName: 'Support team',
          grantedByPrincipalId: ACTOR,
          createdAt,
        },
        {
          id: 'roleassign_2',
          roleId: 'role_admin',
          roleKey: 'admin',
          roleName: 'Admin',
          roleIsSystem: true,
          teamId: null,
          teamName: null,
          grantedByPrincipalId: null,
          createdAt,
        },
      ],
    ]

    await expect(listAssignmentsForPrincipal('principal_user' as PrincipalId)).resolves.toEqual([
      {
        id: 'roleassign_1',
        role: { id: 'role_custom', key: 'support', name: 'Support', isSystem: false },
        teamId: 'team_support',
        teamName: 'Support team',
        grantedByPrincipalId: ACTOR,
        createdAt,
      },
      {
        id: 'roleassign_2',
        role: { id: 'role_admin', key: 'admin', name: 'Admin', isSystem: true },
        teamId: null,
        teamName: null,
        grantedByPrincipalId: null,
        createdAt,
      },
    ])
  })

  it('revokeRoleAssignment deletes and records role_assignment.revoked', async () => {
    h.state.selectResults = [
      [{ principalId: 'principal_user', roleId: 'role_custom', teamId: null, roleKey: 'support' }],
    ]
    await revokeRoleAssignment({
      assignmentId: 'roleassign_1' as RoleAssignmentId,
      actorPrincipalId: ACTOR,
    })
    expect(recordEventMock.mock.calls[0][0]).toMatchObject({
      action: 'role_assignment.revoked',
      targetType: 'principal',
      targetId: 'principal_user',
    })
  })
})
