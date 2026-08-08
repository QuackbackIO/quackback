/**
 * Seat derivation against a real database.
 *
 * The predicate is only half the story — the other half is the join that
 * resolves a teammate's *effective* permissions, and that cannot be tested
 * with a mocked executor: a left join across four tables with a legacy
 * fallback for the no-assignment case is exactly where a seat count goes
 * quietly wrong, and quietly wrong here means a wrong invoice.
 *
 * Every assertion is scoped to **the principals this test created**, never to
 * a whole-table count. Two earlier versions were not, and both were wrong for
 * different reasons:
 *
 *  - Clearing the `principal` table first took a row lock on every principal
 *    in the shared test database, making this file contend with every other
 *    suite touching principals.
 *  - Taking a baseline count and asserting deltas assumed the committed
 *    population is constant for the duration of a test. It is not:
 *    `quackback_test` is shared across checkouts, so another process can
 *    commit principals between the baseline and the assertion. That produced
 *    exactly the kind of failure that never reproduces in isolation.
 *
 * Scoping to created ids removes the assumption altogether.
 *
 * A third version briefly asserted that `countSeats()` agreed with a fold of
 * `seatBreakdown()` over the whole table. That was removed rather than fixed:
 * `countSeats()` *is* that fold, so the assertion was near-tautological, and
 * because the two reads are separate statements a concurrent commit between
 * them made it fail for a reason unrelated to anything it claimed to check.
 * The whole-table count is exercised where it matters — `upgrade-e2e` pushes
 * it to the provider.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type RoleId, type TeamId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  teams,
  user,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { countSeats, seatBreakdown } = await import('../seats')
import type { SeatBreakdownRow, SeatCounts } from '../seats'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ key: permissions.key }).from(permissions).limit(0)
  },
})

async function addTeammate(input: {
  role: 'admin' | 'member' | 'user'
  type?: 'user' | 'service' | 'anonymous'
  grants?: readonly PermissionKey[]
}): Promise<PrincipalId> {
  const type = input.type ?? 'user'
  let userId: UserId | null = null
  if (type !== 'service') {
    userId = createId('user')
    await testDb.insert(user).values({
      id: userId,
      name: `T-${userId}`,
      email: `${userId}@example.test`,
    })
  }
  const principalId = createId('principal')
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: input.role,
    type,
    createdAt: new Date(),
  })

  if (input.grants) {
    const roleId: RoleId = createId('role')
    await testDb.insert(roles).values({
      id: roleId,
      key: `custom-${roleId}`,
      name: `Custom-${roleId}`,
      isSystem: false,
      createdAt: new Date(),
    })
    for (const key of input.grants) {
      const [permission] = await testDb
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.key, key))
        .limit(1)
      if (!permission) throw new Error(`seed: permission ${key} is not seeded in the test database`)
      await testDb
        .insert(rolePermissions)
        .values({ id: createId('role_permission'), roleId, permissionId: permission.id })
    }
    await testDb
      .insert(principalRoleAssignments)
      .values({ id: createId('role_assignment'), principalId, roleId, teamId: null })
  }
  created.push(principalId)
  return principalId
}

/** Principals created by the test currently running. */
let created: PrincipalId[] = []

beforeEach(async () => {
  await fixture.begin()
  created = []
})

/**
 * Seat counts over the principals this test created.
 *
 * Folded from the same `seatBreakdown()` rows `countSeats()` folds, so the
 * classification under test is the real one — only the population is scoped.
 */
async function seatDelta(): Promise<SeatCounts> {
  const rows = await breakdownFor(created)
  let full = 0
  let lite = 0
  let copilotEligible = 0
  for (const row of rows) {
    if (row.lite) lite++
    else full++
    if (row.copilotEligible) copilotEligible++
  }
  return { full, lite, copilotEligible, total: full + lite }
}

/** Breakdown rows for principals this test created. */
async function breakdownFor(ids: PrincipalId[]): Promise<SeatBreakdownRow[]> {
  const wanted = new Set<string>(ids)
  const rows = await seatBreakdown()
  return rows.filter((row) => wanted.has(row.principalId))
}

afterEach(async () => {
  await fixture.rollback()
})

afterAll(async () => {
  await fixture.close()
})

describe.skipIf(!fixture.available)('seat derivation', () => {
  it('counts nobody when no teammate is added', async () => {
    expect(await seatDelta()).toEqual({ full: 0, lite: 0, copilotEligible: 0, total: 0 })
  })

  it('counts admins and members, and nothing else', async () => {
    await addTeammate({ role: 'admin' })
    await addTeammate({ role: 'member' })
    // Not seats: a portal end user, an anonymous visitor, and a machine
    // principal that carries an admin role for an API key or integration.
    await addTeammate({ role: 'user' })
    await addTeammate({ role: 'user', type: 'anonymous' })
    await addTeammate({ role: 'admin', type: 'service' })

    expect(await seatDelta()).toEqual({ full: 2, lite: 0, copilotEligible: 2, total: 2 })
  })

  it('counts a teammate with no custom role as a full seat', async () => {
    // The legacy fallback: no workspace-wide assignment means the preset for
    // the legacy role, and both presets carry write permissions. This is the
    // state of every install that has never adopted custom roles.
    const id = await addTeammate({ role: 'member' })
    // The whole row, against the preset resolved independently by the
    // authorization layer — not a hand-copied permission count.
    expect(await breakdownFor([id])).toEqual([
      {
        principalId: id,
        role: 'member',
        lite: false,
        copilotEligible: true,
        permissionCount: permissionsForLegacyRole('member').size,
      },
    ])
  })

  it('counts a read-only custom role as a lite seat', async () => {
    await addTeammate({
      role: 'member',
      grants: [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.PEOPLE_VIEW],
    })
    expect(await seatDelta()).toEqual({ full: 0, lite: 1, copilotEligible: 0, total: 1 })
  })

  it('promotes the seat to full the moment one write permission is granted', async () => {
    // The commercial property that makes the lite rate safe to offer: the
    // discount cannot be claimed by relabelling, only by genuinely removing
    // the ability to change anything.
    await addTeammate({
      role: 'member',
      grants: [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.CONVERSATION_REPLY],
    })
    expect(await seatDelta()).toEqual({ full: 1, lite: 0, copilotEligible: 0, total: 1 })
  })

  it('counts a custom role with no permissions at all as a lite seat', async () => {
    const id = await addTeammate({ role: 'member', grants: [] })
    expect(await breakdownFor([id])).toEqual([
      { principalId: id, role: 'member', lite: true, copilotEligible: false, permissionCount: 0 },
    ])
  })

  it('counts Copilot access separately from the seat class', async () => {
    await addTeammate({ role: 'member', grants: [PERMISSIONS.CONVERSATION_VIEW] })
    await addTeammate({
      role: 'member',
      grants: [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.COPILOT_USE],
    })
    expect(await seatDelta()).toEqual({ full: 1, lite: 1, copilotEligible: 1, total: 2 })
  })

  it('ignores a team-scoped assignment when resolving workspace permissions', async () => {
    // A team-scoped grant narrows an existing role inside a team; it does not
    // confer workspace access. `permissionsForPrincipal` reads the same way,
    // and a seat count that disagreed with the authorization layer would bill
    // for access the person does not have.
    //
    // The setup is deliberately adversarial: the WORKSPACE-wide grant is
    // read-only (so the seat is lite) and the TEAM-scoped grant is a write
    // (so counting it would flip the seat to full). If the join forgot its
    // `team_id IS NULL` clause, this workspace's invoice would jump.
    const principalId = await addTeammate({
      role: 'member',
      grants: [PERMISSIONS.CONVERSATION_VIEW],
    })
    expect(await seatDelta()).toEqual({ full: 0, lite: 1, copilotEligible: 0, total: 1 })

    const teamId: TeamId = createId('team')
    await testDb.insert(teams).values({ id: teamId, name: `Team-${teamId}` })
    const writeRole: RoleId = createId('role')
    await testDb.insert(roles).values({
      id: writeRole,
      key: `team-write-${writeRole}`,
      name: `TeamWrite-${writeRole}`,
      isSystem: false,
      createdAt: new Date(),
    })
    const [reply] = await testDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, PERMISSIONS.CONVERSATION_REPLY))
      .limit(1)
    await testDb
      .insert(rolePermissions)
      .values({ id: createId('role_permission'), roleId: writeRole, permissionId: reply!.id })
    await testDb.insert(principalRoleAssignments).values({
      id: createId('role_assignment'),
      principalId,
      roleId: writeRole,
      teamId,
    })

    // Still lite. The team-scoped write grant was not counted.
    expect(await seatDelta()).toEqual({ full: 0, lite: 1, copilotEligible: 0, total: 1 })
  })

  it('does not double-count a teammate holding two custom roles', async () => {
    const principalId = await addTeammate({
      role: 'member',
      grants: [PERMISSIONS.CONVERSATION_VIEW],
    })
    const secondRole: RoleId = createId('role')
    await testDb.insert(roles).values({
      id: secondRole,
      key: `second-${secondRole}`,
      name: `Second-${secondRole}`,
      isSystem: false,
      createdAt: new Date(),
    })
    const [reply] = await testDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, PERMISSIONS.CONVERSATION_REPLY))
      .limit(1)
    await testDb
      .insert(rolePermissions)
      .values({ id: createId('role_permission'), roleId: secondRole, permissionId: reply!.id })
    await testDb.insert(principalRoleAssignments).values({
      id: createId('role_assignment'),
      principalId,
      roleId: secondRole,
      teamId: null,
    })

    // Two assignments, four joined rows, one seat — and the union of the two
    // roles' permissions promotes it to full.
    expect(await seatDelta()).toEqual({ full: 1, lite: 0, copilotEligible: 0, total: 1 })
  })
})
