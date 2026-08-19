/**
 * Real-Postgres coverage for the custom-role assignment surface on
 * updateMemberRole (principal.service.ts): a custom grant rides the member
 * legacy role plus a workspace assignment, the Owner preset is unreachable
 * through it, and the last-admin rail composes unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { and, eq, isNull, principal, principalRoleAssignments, roles, user } from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))

import { updateMemberRole } from '../principal.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roles.id }).from(roles).limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(role: 'admin' | 'member') {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'T', email: `t-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return { userId, principalId }
}

async function insertCustomRole(): Promise<RoleId> {
  const id = createId('role') as RoleId
  await testDb.insert(roles).values({ id, key: id, name: 'Custom', isSystem: false })
  return id
}

async function workspaceAssignmentKeys(principalId: PrincipalId) {
  const rows = await testDb
    .select({ roleId: principalRoleAssignments.roleId })
    .from(principalRoleAssignments)
    .where(
      and(
        eq(principalRoleAssignments.principalId, principalId),
        isNull(principalRoleAssignments.teamId)
      )
    )
  return rows.map((r) => r.roleId)
}

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('updateMemberRole — custom grants (real Postgres)', () => {
  it('grants a custom role: legacy column stays member, assignment carries it', async () => {
    const acting = await seedTeammate('admin')
    const target = await seedTeammate('member')
    const customRoleId = await insertCustomRole()

    await updateMemberRole(target.principalId, 'member', acting.principalId, null, undefined, {
      assignRoleId: customRoleId,
      granterPermissions: ALL_PERMISSIONS,
    })

    const [row] = await testDb.select().from(principal).where(eq(principal.id, target.principalId))
    expect(row.role).toBe('member')
    expect(await workspaceAssignmentKeys(target.principalId)).toEqual([customRoleId])
  })

  it('rejects a custom grant on the admin legacy role', async () => {
    const acting = await seedTeammate('admin')
    const target = await seedTeammate('member')
    const customRoleId = await insertCustomRole()

    await expect(
      updateMemberRole(target.principalId, 'admin', acting.principalId, null, undefined, {
        assignRoleId: customRoleId,
        granterPermissions: ALL_PERMISSIONS,
      })
    ).rejects.toThrow(ValidationError)
  })

  it('never grants the Owner preset through assignRoleId', async () => {
    const acting = await seedTeammate('admin')
    const target = await seedTeammate('member')
    const [owner] = await testDb
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, SYSTEM_ROLES.OWNER))
      .limit(1)

    await expect(
      updateMemberRole(target.principalId, 'member', acting.principalId, null, undefined, {
        assignRoleId: owner.id,
        granterPermissions: ALL_PERMISSIONS,
      })
    ).rejects.toThrow(ForbiddenError)
  })

  it('assignment is a grant: rejects a role richer than the assigner (ceiling)', async () => {
    const acting = await seedTeammate('admin')
    const target = await seedTeammate('member')
    // A rich role carrying billing.manage; the assigner holds member.manage
    // but not billing — the F1 escalation shape.
    const richRoleId = await insertCustomRole()
    const [billing] = await testDb
      .select({ id: (await import('@/lib/server/db')).permissions.id })
      .from((await import('@/lib/server/db')).permissions)
      .where(eq((await import('@/lib/server/db')).permissions.key, PERMISSIONS.BILLING_MANAGE))
      .limit(1)
    await testDb
      .insert((await import('@/lib/server/db')).rolePermissions)
      .values({ roleId: richRoleId, permissionId: billing.id })

    await expect(
      updateMemberRole(target.principalId, 'member', acting.principalId, null, undefined, {
        assignRoleId: richRoleId,
        granterPermissions: [PERMISSIONS.MEMBER_MANAGE, PERMISSIONS.MEMBER_VIEW],
      })
    ).rejects.toThrow(/permissions you don't hold/)
    expect(await workspaceAssignmentKeys(target.principalId)).toEqual([])
  })

  it('fails closed when the assigner set is missing entirely', async () => {
    const acting = await seedTeammate('admin')
    const target = await seedTeammate('member')
    const customRoleId = await insertCustomRole()

    await expect(
      updateMemberRole(target.principalId, 'member', acting.principalId, null, undefined, {
        assignRoleId: customRoleId,
      })
    ).rejects.toThrow(ForbiddenError)
  })

  it('demote-to-custom (two admins) replaces the Owner row and records the grantor', async () => {
    const acting = await seedTeammate('admin')
    const target = await seedTeammate('admin')
    const [owner] = await testDb
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, SYSTEM_ROLES.OWNER))
      .limit(1)
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: target.principalId, roleId: owner.id })
    const customRoleId = await insertCustomRole()

    await updateMemberRole(target.principalId, 'member', acting.principalId, null, undefined, {
      assignRoleId: customRoleId,
      granterPermissions: ALL_PERMISSIONS,
    })

    const rows = await testDb
      .select()
      .from(principalRoleAssignments)
      .where(
        and(
          eq(principalRoleAssignments.principalId, target.principalId),
          isNull(principalRoleAssignments.teamId)
        )
      )
    expect(rows.map((r) => r.roleId)).toEqual([customRoleId])
    expect(rows[0].grantedByPrincipalId).toBe(acting.principalId)
  })

  it('the last-admin rail fires on a demote-to-custom', async () => {
    const acting = await seedTeammate('member')
    const lastAdmin = await seedTeammate('admin')
    const customRoleId = await insertCustomRole()

    await expect(
      updateMemberRole(lastAdmin.principalId, 'member', acting.principalId, null, undefined, {
        assignRoleId: customRoleId,
        granterPermissions: ALL_PERMISSIONS,
      })
    ).rejects.toThrow(/last admin/i)
  })
})
