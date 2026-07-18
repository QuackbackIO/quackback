/**
 * Real-Postgres regression coverage for the assignment lifecycle in
 * setPrincipalRole (principal.factory.ts) and the seed heal/backfill
 * (seed-system.ts).
 *
 * The bug this pins: the seed backfill wrote an Owner/Manager
 * principal_role_assignments row for every admin/member, but role writes only
 * touched the legacy principal.role column — the assignment row survived
 * demotion AND removal. permissionsForPrincipal trusts assignment rows
 * unconditionally whenever any exist, and requireAuth is permission-only, so a
 * removed admin kept passing every permission gate with the full Owner set.
 * setPrincipalRole now reconciles the workspace-wide assignment in the same
 * transaction, and the seed heals rows the old code left behind.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  isNull,
  principal,
  principalRoleAssignments,
  roles,
  seedSystemData,
  user,
} from '@/lib/server/db'
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'

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

import { setPrincipalRole } from '../principal.factory'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: roles.id, key: roles.key }).from(roles).limit(0)
    await db.select({ id: principalRoleAssignments.id }).from(principalRoleAssignments).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function presetRoleId(key: string): Promise<RoleId> {
  const [row] = await testDb.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1)
  if (!row) throw new Error(`preset role ${key} not seeded in the test database`)
  return row.id
}

/** Seed a human teammate with the given legacy role and one workspace assignment. */
async function seedTeammate(role: 'admin' | 'member', assignedRoleKey?: string) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: 'Teammate', email: `t-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  if (assignedRoleKey) {
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId, roleId: await presetRoleId(assignedRoleKey) })
  }
  return { userId, principalId }
}

async function workspaceAssignments(principalId: PrincipalId) {
  return testDb
    .select({ roleId: principalRoleAssignments.roleId, key: roles.key })
    .from(principalRoleAssignments)
    .leftJoin(roles, eq(roles.id, principalRoleAssignments.roleId))
    .where(
      and(
        eq(principalRoleAssignments.principalId, principalId),
        isNull(principalRoleAssignments.teamId)
      )
    )
}

async function insertCustomRole(): Promise<RoleId> {
  const id = createId('role') as RoleId
  await testDb
    .insert(roles)
    .values({ id, key: `custom-${suffix()}`, name: 'Custom role', isSystem: false })
  return id
}

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)(
  'setPrincipalRole — assignment reconcile (real Postgres)',
  () => {
    it('demotion admin -> member rewrites the Owner assignment to exactly Manager', async () => {
      const target = await seedTeammate('admin', SYSTEM_ROLES.OWNER)
      await seedTeammate('admin', SYSTEM_ROLES.OWNER) // second admin so the last-admin rail passes

      await setPrincipalRole({ principalId: target.principalId }, 'member')

      const rows = await workspaceAssignments(target.principalId)
      expect(rows.map((r) => r.key)).toEqual([SYSTEM_ROLES.MANAGER])
      const perms = await permissionsForPrincipal(target.principalId, 'member')
      expect(perms.has(PERMISSIONS.BILLING_MANAGE)).toBe(false)
      expect(perms.has(PERMISSIONS.MEMBER_MANAGE)).toBe(false)
      expect(perms.has(PERMISSIONS.POST_VIEW_PRIVATE)).toBe(true)
    })

    it('removal admin -> user deletes every workspace assignment (no retained grants)', async () => {
      const target = await seedTeammate('admin', SYSTEM_ROLES.OWNER)
      await seedTeammate('admin', SYSTEM_ROLES.OWNER)

      await setPrincipalRole({ principalId: target.principalId }, 'user')

      expect(await workspaceAssignments(target.principalId)).toHaveLength(0)
      const perms = await permissionsForPrincipal(target.principalId, 'user')
      expect(perms.size).toBe(0)
    })

    it('promotion member -> admin replaces a stale Manager row with exactly Owner', async () => {
      const target = await seedTeammate('member', SYSTEM_ROLES.MANAGER)

      await setPrincipalRole({ principalId: target.principalId }, 'admin')

      const rows = await workspaceAssignments(target.principalId)
      expect(rows.map((r) => r.key)).toEqual([SYSTEM_ROLES.OWNER])
    })

    it('honours an explicit assignRoleId instead of the legacy preset mapping', async () => {
      const target = await seedTeammate('member', SYSTEM_ROLES.MANAGER)
      const customRoleId = await insertCustomRole()

      await setPrincipalRole({ principalId: target.principalId }, 'member', {
        assignRoleId: customRoleId,
      })

      const rows = await workspaceAssignments(target.principalId)
      expect(rows.map((r) => r.roleId)).toEqual([customRoleId])
      // The custom role has no role_permissions rows: the assignment must win
      // over the legacy 'member' fallback and resolve to an empty set.
      const perms = await permissionsForPrincipal(target.principalId, 'member')
      expect(perms.size).toBe(0)
    })

    it('a redundant same-role save preserves an explicit custom assignment', async () => {
      const target = await seedTeammate('member', SYSTEM_ROLES.MANAGER)
      const customRoleId = await insertCustomRole()
      await setPrincipalRole({ principalId: target.principalId }, 'member', {
        assignRoleId: customRoleId,
      })

      // Re-saving the same legacy role with no explicit assignment must not
      // revert the custom grant to the Manager preset.
      await setPrincipalRole({ principalId: target.principalId }, 'member')

      const rows = await workspaceAssignments(target.principalId)
      expect(rows.map((r) => r.roleId)).toEqual([customRoleId])
    })

    it('a guard-filtered no-op write leaves the assignment untouched', async () => {
      const target = await seedTeammate('admin', SYSTEM_ROLES.OWNER)
      await seedTeammate('admin', SYSTEM_ROLES.OWNER)

      await setPrincipalRole({ principalId: target.principalId }, 'user', {
        guards: { onlyType: 'service' },
      })

      const [row] = await testDb
        .select()
        .from(principal)
        .where(eq(principal.id, target.principalId))
      expect(row.role).toBe('admin')
      const rows = await workspaceAssignments(target.principalId)
      expect(rows.map((r) => r.key)).toEqual([SYSTEM_ROLES.OWNER])
    })
  }
)

describe.skipIf(!fixture.available)('seed heal + backfill (real Postgres)', () => {
  it('heals pre-reconcile rows, backfills the gap, and never augments explicit grants', async () => {
    // A: demoted admin from the pre-fix era — role='member', stale Owner row.
    const demoted = await seedTeammate('member', SYSTEM_ROLES.OWNER)
    // B: removed teammate from the pre-fix era — role='user', stale Manager row.
    const removed = await seedTeammate('member', SYSTEM_ROLES.MANAGER)
    await testDb
      .update(principal)
      .set({ role: 'user' })
      .where(eq(principal.id, removed.principalId))
    // C: explicit custom-role grant — must survive untouched, not gain Manager.
    const customHolder = await seedTeammate('member')
    const customRoleId = await insertCustomRole()
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: customHolder.principalId, roleId: customRoleId })
    // D: fresh admin with no assignment — the normal backfill case.
    const fresh = await seedTeammate('admin')
    // E: an Owner-preset row with a recorded grantor on a member — an explicit
    // grant, which the heal must never reap (it only owns grantor-less rows).
    const explicit = await seedTeammate('member')
    await testDb.insert(principalRoleAssignments).values({
      principalId: explicit.principalId,
      roleId: await presetRoleId(SYSTEM_ROLES.OWNER),
      grantedByPrincipalId: fresh.principalId,
    })

    await seedSystemData(testDb)

    expect((await workspaceAssignments(demoted.principalId)).map((r) => r.key)).toEqual([
      SYSTEM_ROLES.MANAGER,
    ])
    expect(await workspaceAssignments(removed.principalId)).toHaveLength(0)
    expect((await workspaceAssignments(customHolder.principalId)).map((r) => r.roleId)).toEqual([
      customRoleId,
    ])
    expect((await workspaceAssignments(fresh.principalId)).map((r) => r.key)).toEqual([
      SYSTEM_ROLES.OWNER,
    ])
    expect((await workspaceAssignments(explicit.principalId)).map((r) => r.key)).toEqual([
      SYSTEM_ROLES.OWNER,
    ])
  })

  it('is idempotent: a second run changes nothing', async () => {
    const admin = await seedTeammate('admin')
    await seedSystemData(testDb)
    const first = await workspaceAssignments(admin.principalId)
    await seedSystemData(testDb)
    const second = await workspaceAssignments(admin.principalId)
    expect(second).toEqual(first)
    expect(second.map((r) => r.key)).toEqual([SYSTEM_ROLES.OWNER])
  })
})
