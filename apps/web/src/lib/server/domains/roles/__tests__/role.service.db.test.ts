/**
 * Real-Postgres coverage for custom-role CRUD (role.service.ts): the rails
 * that make role.manage safe — system presets read-only, the grant ceiling
 * (structural block on transitive self-elevation), the held-role lock, the
 * in-use delete + reassignment, and the tier cap seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  isNull,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  user,
} from '@/lib/server/db'
import { PERMISSIONS, SYSTEM_ROLES, ALL_PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const hoisted = vi.hoisted(() => ({
  maxCustomRoles: null as number | null,
  recordAuditEvent: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({ maxCustomRoles: hoisted.maxCustomRoles }),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.recordAuditEvent,
  actorFromAuth: vi.fn(),
}))

import { listRoles, createRole, updateRole, deleteRole, type RoleEditor } from '../role.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roles.id, key: roles.key }).from(roles).limit(0)
    await db.select({ id: permissions.id }).from(permissions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** An Owner-grade editor (holds everything). */
function ownerEditor(principalId?: PrincipalId): RoleEditor {
  return {
    principalId: principalId ?? (createId('principal') as PrincipalId),
    permissions: ALL_PERMISSIONS,
  }
}

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'T', email: `t-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

async function roleByKey(key: string) {
  const [row] = await testDb.select().from(roles).where(eq(roles.key, key)).limit(1)
  return row
}

if (fixture.available) {
  beforeEach(() => {
    hoisted.maxCustomRoles = null
    hoisted.recordAuditEvent.mockClear()
    return fixture.begin()
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('role.service (real Postgres)', () => {
  it('lists presets first with permission keys and member counts', async () => {
    const holder = await seedPrincipal()
    const manager = await roleByKey(SYSTEM_ROLES.MANAGER)
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: holder, roleId: manager.id })

    const all = await listRoles()
    expect(all[0].key).toBe(SYSTEM_ROLES.OWNER)
    expect(all[0].isSystem).toBe(true)
    expect(all[0].permissionKeys.length).toBe(ALL_PERMISSIONS.length)
    const managerMeta = all.find((r) => r.key === SYSTEM_ROLES.MANAGER)
    expect(managerMeta?.memberCount).toBeGreaterThanOrEqual(1)
  })

  it('creates a blank role and an audit event', async () => {
    const editor = ownerEditor(await seedPrincipal())
    const { role, droppedKeys } = await createRole({ name: 'Support Lead' }, editor, { actor: {} })
    expect(role.isSystem).toBe(false)
    expect(role.permissionKeys).toEqual([])
    expect(droppedKeys).toEqual([])
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'role.created' })
    )
  })

  it('creates with an explicit permissionKeys set (the create page path)', async () => {
    const editor = ownerEditor(await seedPrincipal())
    const { role } = await createRole(
      {
        name: 'Explicit',
        permissionKeys: [PERMISSIONS.POST_VIEW_PRIVATE, PERMISSIONS.TICKET_VIEW],
      },
      editor
    )
    expect(new Set(role.permissionKeys)).toEqual(
      new Set([PERMISSIONS.POST_VIEW_PRIVATE, PERMISSIONS.TICKET_VIEW])
    )
  })

  it('rejects an explicit permissionKeys set above the editor ceiling', async () => {
    const limited: RoleEditor = {
      principalId: await seedPrincipal(),
      permissions: [PERMISSIONS.POST_VIEW_PRIVATE],
    }
    await expect(
      createRole({ name: 'Too much', permissionKeys: [PERMISSIONS.BILLING_MANAGE] }, limited)
    ).rejects.toThrow(/permissions you don't hold/)
  })

  it('duplicating intersects with the editor grant ceiling and reports drops', async () => {
    const owner = await roleByKey(SYSTEM_ROLES.OWNER)
    const editor: RoleEditor = {
      principalId: await seedPrincipal(),
      // An Admin-grade editor: everything except billing.
      permissions: ALL_PERMISSIONS.filter((k) => k !== PERMISSIONS.BILLING_MANAGE),
    }

    const { role, droppedKeys } = await createRole(
      { name: 'Almost Owner', duplicateFromRoleId: owner.id },
      editor
    )
    expect(droppedKeys).toEqual([PERMISSIONS.BILLING_MANAGE])
    expect(role.permissionKeys).not.toContain(PERMISSIONS.BILLING_MANAGE)
    expect(role.permissionKeys).toContain(PERMISSIONS.MEMBER_MANAGE)
  })

  it('enforces the maxCustomRoles tier cap', async () => {
    hoisted.maxCustomRoles = 1
    const editor = ownerEditor(await seedPrincipal())
    await createRole({ name: 'First' }, editor)
    await expect(createRole({ name: 'Second' }, editor)).rejects.toThrow(TierLimitError)
  })

  it('updates name and permission set, bumping updatedAt', async () => {
    const editor = ownerEditor(await seedPrincipal())
    const { role } = await createRole({ name: 'Triage' }, editor)

    const updated = await updateRole(
      role.id,
      { name: 'Triage Team', permissionKeys: [PERMISSIONS.POST_VIEW_PRIVATE] },
      editor
    )
    expect(updated.name).toBe('Triage Team')
    expect(updated.permissionKeys).toEqual([PERMISSIONS.POST_VIEW_PRIVATE])
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(role.updatedAt.getTime())

    const removed = await updateRole(role.id, { permissionKeys: [] }, editor)
    expect(removed.permissionKeys).toEqual([])
  })

  it('surfaces catalogue keys added after the last edit as newPermissionKeys', async () => {
    const editor = ownerEditor(await seedPrincipal())
    const { role } = await createRole({ name: 'Aging role' }, editor)
    // Backdate the role's last edit, then land a "new" catalogue key.
    await testDb
      .update(roles)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(roles.id, role.id))
    const freshKey = `test.${suffix()}`
    await testDb.insert(permissions).values({ key: freshKey, category: 'workspace' })

    const meta = (await listRoles()).find((r) => r.id === role.id)
    expect(meta?.newPermissionKeys).toContain(freshKey)
    // Presets never badge: the seed reconcile keeps them current.
    const owner = (await listRoles()).find((r) => r.key === SYSTEM_ROLES.OWNER)
    expect(owner?.newPermissionKeys).toEqual([])
  })

  it('rejects edits and deletes on system presets', async () => {
    const editor = ownerEditor(await seedPrincipal())
    const owner = await roleByKey(SYSTEM_ROLES.OWNER)
    await expect(updateRole(owner.id, { name: 'Nope' }, editor)).rejects.toThrow(ForbiddenError)
    await expect(deleteRole(owner.id, {}, editor)).rejects.toThrow(ForbiddenError)
  })

  it("locks a role against its own holder ('can't edit a role you hold')", async () => {
    const holderId = await seedPrincipal()
    const editor = ownerEditor(holderId)
    const { role } = await createRole({ name: 'Held' }, editor)
    await testDb.insert(principalRoleAssignments).values({ principalId: holderId, roleId: role.id })

    await expect(updateRole(role.id, { name: 'X' }, editor)).rejects.toThrow(/currently hold/)
    await expect(deleteRole(role.id, {}, editor)).rejects.toThrow(/currently hold/)
  })

  it('rejects above-ceiling additions on update (server-side, not just UI)', async () => {
    const limited: RoleEditor = {
      principalId: await seedPrincipal(),
      permissions: [PERMISSIONS.POST_VIEW_PRIVATE],
    }
    const { role } = await createRole({ name: 'Limited edit' }, limited)

    await expect(
      updateRole(role.id, { permissionKeys: [PERMISSIONS.BILLING_MANAGE] }, limited)
    ).rejects.toThrow(/can't grant permissions you don't hold/)
  })

  it('rejects unknown permission keys', async () => {
    const editor = ownerEditor(await seedPrincipal())
    const { role } = await createRole({ name: 'Bad keys' }, editor)
    await expect(
      updateRole(role.id, { permissionKeys: ['not.a.permission' as never] }, editor)
    ).rejects.toThrow(ValidationError)
  })

  it('blocks deleting an in-use role without a reassignment target', async () => {
    const editor = ownerEditor(await seedPrincipal())
    const holder = await seedPrincipal()
    const { role } = await createRole({ name: 'In use' }, editor)
    await testDb.insert(principalRoleAssignments).values({ principalId: holder, roleId: role.id })

    await expect(deleteRole(role.id, {}, editor)).rejects.toThrow(/hold this role/)
  })

  it('delete-with-reassign moves holders (grantor recorded) and cascades cleanly', async () => {
    const editorId = await seedPrincipal()
    const editor = ownerEditor(editorId)
    const holderA = await seedPrincipal()
    const holderB = await seedPrincipal()
    const { role } = await createRole({ name: 'Doomed' }, editor)
    const { role: target } = await createRole({ name: 'Landing spot' }, editor)
    await testDb.insert(principalRoleAssignments).values([
      { principalId: holderA, roleId: role.id },
      { principalId: holderB, roleId: role.id },
    ])

    const { reassignedCount } = await deleteRole(role.id, { reassignToRoleId: target.id }, editor)
    expect(reassignedCount).toBe(2)

    const moved = await testDb
      .select()
      .from(principalRoleAssignments)
      .where(
        and(eq(principalRoleAssignments.roleId, target.id), isNull(principalRoleAssignments.teamId))
      )
    expect(moved.map((m) => m.principalId).sort()).toEqual([holderA, holderB].sort())
    expect(moved.every((m) => m.grantedByPrincipalId === editorId)).toBe(true)

    expect(await testDb.select().from(roles).where(eq(roles.id, role.id))).toHaveLength(0)
    expect(
      await testDb.select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id))
    ).toHaveLength(0)
  })

  it('reassignment is a grant: a limited editor cannot move holders onto a richer role', async () => {
    // The F1 exploit shape: role.manage without the admin bundle must not be
    // able to hand out the Admin preset (or any richer role) via delete.
    const limited: RoleEditor = {
      principalId: await seedPrincipal(),
      permissions: [PERMISSIONS.ROLE_MANAGE, PERMISSIONS.MEMBER_MANAGE, PERMISSIONS.MEMBER_VIEW],
    }
    const holder = await seedPrincipal()
    const { role } = await createRole({ name: 'Throwaway' }, limited)
    await testDb.insert(principalRoleAssignments).values({ principalId: holder, roleId: role.id })
    const adminPreset = await roleByKey(SYSTEM_ROLES.ADMIN)

    await expect(
      deleteRole(role.id, { reassignToRoleId: adminPreset.id }, limited)
    ).rejects.toThrow(/permissions you don't hold/)
    // The role must survive the refused delete.
    expect(await testDb.select().from(roles).where(eq(roles.id, role.id))).toHaveLength(1)
  })

  it('a limited editor can remove keys it does not hold (de-escalation is free)', async () => {
    const ownerGrade = ownerEditor(await seedPrincipal())
    const { role } = await createRole(
      { name: 'Rich role', duplicateFromRoleId: (await roleByKey(SYSTEM_ROLES.MANAGER)).id },
      ownerGrade
    )
    const limited: RoleEditor = {
      principalId: await seedPrincipal(),
      permissions: [PERMISSIONS.ROLE_MANAGE],
    }

    const updated = await updateRole(role.id, { permissionKeys: [] }, limited)
    expect(updated.permissionKeys).toEqual([])
  })

  it('emits role.updated and role.deleted audit events', async () => {
    const editor = ownerEditor(await seedPrincipal())
    const { role } = await createRole({ name: 'Audited' }, editor)
    await updateRole(role.id, { name: 'Audited 2' }, editor, { actor: {} })
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'role.updated' })
    )
    await deleteRole(role.id, {}, editor, { actor: {} })
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'role.deleted' })
    )
  })

  it('never reassigns onto the Owner preset', async () => {
    const editor = ownerEditor(await seedPrincipal())
    const holder = await seedPrincipal()
    const { role } = await createRole({ name: 'No owner path' }, editor)
    await testDb.insert(principalRoleAssignments).values({ principalId: holder, roleId: role.id })
    const owner = await roleByKey(SYSTEM_ROLES.OWNER)

    await expect(deleteRole(role.id, { reassignToRoleId: owner.id }, editor)).rejects.toThrow(
      /Owner/
    )
  })

  it('404s on a missing role', async () => {
    const editor = ownerEditor(await seedPrincipal())
    await expect(updateRole(createId('role') as RoleId, { name: 'X' }, editor)).rejects.toThrow(
      NotFoundError
    )
  })
})
