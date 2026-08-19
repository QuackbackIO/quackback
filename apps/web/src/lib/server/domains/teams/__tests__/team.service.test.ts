/**
 * Real-DB coverage for the teams service (§4.12): CRUD, single-default
 * enforcement, the default-team delete guard, membership, and the
 * default-team backfill hook. Runs inside the db-test-fixture rollback
 * transaction (see server/__tests__/README.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TypeId, type UserId } from '@quackback/ids'

type TeamId = TypeId<'team'>

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { teams, teamMembers, principal, user, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  createTeam,
  updateTeam,
  deleteTeam,
  getTeam,
  setDefaultTeam,
  listTeams,
  listTeamMembers,
  setTeamMembers,
  addPrincipalToDefaultTeam,
} from '../team.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: teams.id }).from(teams).limit(0)
    await db.select({ id: teamMembers.id }).from(teamMembers).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(role: 'admin' | 'member' = 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `T-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function seedEndUser(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return principalId
}

/** The seeded default team (there is exactly one non-deleted default). */
async function defaultTeam() {
  const [row] = await testDb.select().from(teams).where(eq(teams.isDefault, true)).limit(1)
  return row
}

describe.skipIf(!fixture.available)('team.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('seeds exactly one default team named Support', async () => {
    const dflt = await defaultTeam()
    expect(dflt?.name).toBe('Support')
    expect(dflt?.isDefault).toBe(true)
  })

  it('creates, reads, updates, and soft-deletes a team', async () => {
    const created = await createTeam({
      name: 'Billing',
      icon: '💳',
      assignmentMethod: 'round_robin',
    })
    expect(created.name).toBe('Billing')
    expect(created.assignmentMethod).toBe('round_robin')
    expect(created.isDefault).toBe(false)

    const fetched = await getTeam(created.id as TeamId)
    expect(fetched.id).toBe(created.id)

    const updated = await updateTeam(created.id as TeamId, { name: 'Billing & Payments' })
    expect(updated.name).toBe('Billing & Payments')

    await deleteTeam(created.id as TeamId)
    await expect(getTeam(created.id as TeamId)).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' })
    // Soft delete: the row survives with deleted_at set.
    const [raw] = await testDb.select().from(teams).where(eq(teams.id, created.id))
    expect(raw.deletedAt).not.toBeNull()
  })

  it('refuses to delete the default team', async () => {
    const dflt = await defaultTeam()
    await expect(deleteTeam(dflt!.id as TeamId)).rejects.toMatchObject({ code: 'TEAM_IS_DEFAULT' })
  })

  it('enforces a single default holder when promoting', async () => {
    const other = await createTeam({ name: 'Tier 2' })
    const promoted = await setDefaultTeam(other.id as TeamId)
    expect(promoted.isDefault).toBe(true)

    // Exactly one default remains, and it is the newly promoted team.
    const stillDefault = (await listTeams()).filter((t) => t.isDefault)
    expect(stillDefault).toHaveLength(1)
    expect(stillDefault[0].id).toBe(other.id)
  })

  it('replaces the membership set with setTeamMembers, rejecting non-teammates', async () => {
    const team = await createTeam({ name: 'Escalations' })
    const a = await seedTeammate()
    const b = await seedTeammate()
    const c = await seedTeammate()
    const enduser = await seedEndUser()

    await setTeamMembers(team.id as TeamId, [a, b])
    expect((await listTeamMembers(team.id as TeamId)).map((m) => m.principalId).sort()).toEqual(
      [a, b].sort()
    )

    // Swap b out for c.
    await setTeamMembers(team.id as TeamId, [a, c])
    expect((await listTeamMembers(team.id as TeamId)).map((m) => m.principalId).sort()).toEqual(
      [a, c].sort()
    )

    // A non-teammate anywhere in the desired set rejects the whole update.
    await expect(setTeamMembers(team.id as TeamId, [a, enduser])).rejects.toMatchObject({
      code: 'INVALID_TEAM_MEMBER',
    })
    expect((await listTeamMembers(team.id as TeamId)).map((m) => m.principalId).sort()).toEqual(
      [a, c].sort()
    )
  })

  it('backfills a teammate into the default team, idempotently', async () => {
    const teammate = await seedTeammate()
    await addPrincipalToDefaultTeam(teammate)
    await addPrincipalToDefaultTeam(teammate)
    const dflt = await defaultTeam()
    const members = await listTeamMembers(dflt!.id as TeamId)
    expect(members.filter((m) => m.principalId === teammate)).toHaveLength(1)
  })
})
