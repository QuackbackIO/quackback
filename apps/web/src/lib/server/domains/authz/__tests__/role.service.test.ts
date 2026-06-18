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
  getRoleWithPermissions,
  createRole,
  updateRole,
  deleteRole,
  setRolePermissions,
  assignRole,
  revokeRoleAssignment,
} from '../role.service'
import type { RoleId, PrincipalId, RoleAssignmentId } from '@quackback/ids'

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

  it('updateRole on a custom role records role.updated with a before/after diff', async () => {
    h.state.selectResults = [[CUSTOM_ROLE]]
    await updateRole({ id: 'role_custom' as RoleId, name: 'Renamed', actorPrincipalId: ACTOR })
    expect(recordEventMock).toHaveBeenCalledTimes(1)
    const ev = recordEventMock.mock.calls[0][0]
    expect(ev).toMatchObject({ action: 'role.updated', targetId: 'role_custom' })
    expect(ev.diff.before.name).toBe('Support')
    expect(ev.diff.after.name).toBe('Renamed')
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
