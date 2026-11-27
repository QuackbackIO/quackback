import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, session, user } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const mocks = vi.hoisted(() => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: () => Promise<unknown>) => Object.assign(handler, chain)
    return chain
  },
}))

import { listTeamMembers } from '../principal.service'
import { fetchTeamMembersAndInvitations } from '@/lib/server/functions/settings'

const fixture = await createDbTestFixture({
  probe: async (db) =>
    void (await db.select({ at: principal.lastSsoSignInAt }).from(principal).limit(0)),
})

// The two rosters serialize differently but must choose the same sign-in time.
describe.skipIf(!fixture.available)('member last sign-in (real DB)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  for (const [label, sso, sessions, expected] of [
    ['SSO without a surviving session', '2026-10-20T12:00:00Z', [], '2026-10-20T12:00:00Z'],
    [
      'SSO newer than sessions',
      '2026-10-20T12:00:00Z',
      ['2026-10-18T12:00:00Z'],
      '2026-10-20T12:00:00Z',
    ],
    [
      'latest session newer than SSO',
      '2026-10-18T12:00:00Z',
      ['2026-10-19T12:00:00Z', '2026-10-20T12:00:00Z'],
      '2026-10-20T12:00:00Z',
    ],
    ['password session only', null, ['2026-10-20T12:00:00Z'], '2026-10-20T12:00:00Z'],
    ['never signed in', null, [], null],
  ] as const) {
    it(label, async () => {
      const userId = createId('user')
      const principalId = createId('principal')
      await testDb.insert(user).values({ id: userId, name: 'Teammate' })
      await testDb.insert(principal).values({
        id: principalId,
        userId,
        type: 'user',
        role: 'member',
        createdAt: new Date(),
        lastSsoSignInAt: sso ? new Date(sso) : null,
      })
      for (const at of sessions) {
        const id = crypto.randomUUID()
        await testDb.insert(session).values({
          id,
          token: id,
          userId,
          createdAt: new Date(at),
          updatedAt: new Date(at),
          expiresAt: new Date('2027-01-01'),
        })
      }
      const roster = await listTeamMembers()
      expect(roster.find((m) => m.id === principalId)?.lastSignInAt?.toISOString() ?? null).toBe(
        expected ? new Date(expected).toISOString() : null
      )
      const settingsRoster = await fetchTeamMembersAndInvitations()
      const settingsAt = settingsRoster.members.find((m) => m.id === principalId)?.lastSignInAt
      expect(settingsAt == null ? null : new Date(settingsAt).toISOString()).toBe(
        expected ? new Date(expected).toISOString() : null
      )
      expect(mocks.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.MEMBER_VIEW })
    })
  }
  it('keeps portal users, anonymous visitors and service principals out of both rosters', async () => {
    const ids = []
    for (const [type, role] of [
      ['user', 'user'],
      ['anonymous', 'user'],
      ['service', 'member'],
    ] as const) {
      const userId = createId('user')
      const id = createId('principal')
      ids.push(id)
      await testDb.insert(user).values({ id: userId, name: 'Not a teammate' })
      await testDb
        .insert(principal)
        .values({ id, userId, type, role, createdAt: new Date(), lastSsoSignInAt: new Date() })
    }
    const roster = await listTeamMembers()
    const settingsRoster = await fetchTeamMembersAndInvitations()
    expect(roster.filter((m) => ids.includes(m.id))).toEqual([])
    expect(settingsRoster.members.filter((m) => ids.includes(m.id))).toEqual([])
  })

  it('still requires member-view permission for the settings roster', async () => {
    const denied = new Error('permission denied')
    mocks.requireAuth.mockRejectedValueOnce(denied)
    await expect(fetchTeamMembersAndInvitations()).rejects.toBe(denied)
    expect(mocks.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.MEMBER_VIEW })
  })
})
