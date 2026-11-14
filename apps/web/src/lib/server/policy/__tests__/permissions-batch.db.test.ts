/**
 * `permissionsForPrincipals` resolves many people's permissions in one query
 * and must give, for each person, exactly what `permissionsForPrincipal` gives
 * them one at a time: the union of their workspace-wide roles' keys, an empty
 * set for a role with no keys, and the legacy preset when they hold no
 * workspace-wide assignment (none at all, or a team-scoped one only).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principalRoleAssignments, roles } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { seedPerson, seedRole, seedTeam } from '@/lib/server/__tests__/scope-seed'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { permissionsForPrincipal, permissionsForPrincipals } from '../permissions'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roles.id }).from(roles).limit(0)
  },
})

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe('permissionsForPrincipals', () => {
  it('matches permissionsForPrincipal for every assignment shape, in one query', async () => {
    const legacyMember = await seedPerson('legacy', 'member')
    const legacyUser = await seedPerson('former', 'user')
    const scoped = await seedPerson('scoped', 'member', { keys: [PERMISSIONS.CONVERSATION_VIEW] })
    const empty = await seedPerson('empty', 'member', { keys: [] })
    const multi = await seedPerson('multi', 'member', { keys: [PERMISSIONS.TICKET_VIEW] })
    await testDb.insert(principalRoleAssignments).values({
      principalId: multi.id,
      roleId: await seedRole([PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.TICKET_VIEW]),
    })
    const teamOnly = await seedPerson('team-only', 'member')
    const team = await seedTeam('Billing', [teamOnly.id])
    await testDb.insert(principalRoleAssignments).values({
      principalId: teamOnly.id,
      roleId: await seedRole([PERMISSIONS.CONVERSATION_VIEW]),
      teamId: team,
    })

    const people: Array<{ id: PrincipalId; role: 'admin' | 'member' | 'user' }> = [
      { id: legacyMember.id, role: 'member' },
      { id: legacyUser.id, role: 'user' },
      { id: scoped.id, role: 'member' },
      { id: empty.id, role: 'member' },
      { id: multi.id, role: 'member' },
      { id: teamOnly.id, role: 'member' },
    ]
    const batch = await permissionsForPrincipals(people)

    for (const p of people) {
      const one = await permissionsForPrincipal(p.id, p.role)
      expect([...(batch.get(p.id) ?? ['missing'])].sort(), p.id).toEqual([...one].sort())
    }
    expect([...batch.get(scoped.id)!]).toEqual([PERMISSIONS.CONVERSATION_VIEW])
    expect(batch.get(empty.id)!.size).toBe(0)
    expect([...batch.get(multi.id)!].sort()).toEqual(
      [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.TICKET_VIEW].sort()
    )
    expect(batch.get(legacyUser.id)!.size).toBe(0)
    expect(batch.get(legacyMember.id)!.has(PERMISSIONS.CONVERSATION_VIEW_ALL)).toBe(true)
    expect(batch.get(teamOnly.id)!.has(PERMISSIONS.CONVERSATION_VIEW_ALL)).toBe(true)
  })

  it('returns an empty map for no people', async () => {
    expect((await permissionsForPrincipals([])).size).toBe(0)
  })
})
