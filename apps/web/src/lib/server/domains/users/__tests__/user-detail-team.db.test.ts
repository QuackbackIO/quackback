/**
 * Real-Postgres coverage for the person detail query's team fields: the
 * admin detail page keeps showing someone after they join the team
 * (`includeTeammates`), reports their team role (and a non-default granted
 * role), and whether they have signed in (the same predicate that gates
 * adding them to the team). Other callers keep the portal-user-only lookup.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  account,
  auditLog,
  eq,
  principal,
  principalRoleAssignments,
  roles,
  session,
  user,
} from '@/lib/server/db'
import { SYSTEM_ROLES } from '@/lib/shared/permissions'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { getPortalUserDetail } = await import('../user.detail')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id, type: principal.type }).from(principal).limit(0)
    await db.select({ id: account.id }).from(account).limit(0)
    await db.select({ id: session.id, scope: session.scope }).from(session).limit(0)
    await db.select({ id: principalRoleAssignments.id }).from(principalRoleAssignments).limit(0)
  },
})

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(opts: {
  role: 'admin' | 'member' | 'user'
  type?: 'user' | 'support'
  signIn?: 'account' | 'portal' | 'widget' | 'none'
}): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'P', email: `p-${tag()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.role,
    type: opts.type ?? 'user',
    createdAt: new Date(),
  })
  const signIn = opts.signIn ?? 'none'
  if (signIn === 'account') {
    await testDb
      .insert(account)
      .values({ accountId: `sub-${tag()}`, providerId: 'github', userId, updatedAt: new Date() })
  } else if (signIn === 'portal' || signIn === 'widget') {
    await testDb.insert(session).values({
      id: `s-${tag()}`,
      token: `t-${tag()}`,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
      scope: signIn,
    })
  }
  return principalId
}

async function assign(principalId: PrincipalId, roleId: RoleId) {
  await testDb.insert(principalRoleAssignments).values({ principalId, roleId })
}

async function systemRoleId(key: string): Promise<RoleId> {
  const [row] = await testDb.select({ id: roles.id }).from(roles).where(eq(roles.key, key))
  return row.id as RoleId
}

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('getPortalUserDetail team fields', () => {
  it('a portal user: no team role; signed in via an account or a portal session', async () => {
    for (const signIn of ['account', 'portal'] as const) {
      const id = await seedPerson({ role: 'user', signIn })
      const detail = await getPortalUserDetail(id, { includeTeammates: true })
      expect(detail).toMatchObject({ principalId: id, teamRole: null, hasSignedIn: true })
    }
  })

  it('signed in by email with no session left: the sign-in record counts', async () => {
    const id = await seedPerson({ role: 'user' })
    const [row] = await testDb.select().from(principal).where(eq(principal.id, id))
    await testDb.insert(auditLog).values({
      eventType: 'auth.signin.success',
      actorUserId: row.userId,
      metadata: { method: 'magic-link' },
    })
    expect(await getPortalUserDetail(id)).toMatchObject({ hasSignedIn: true })
  })

  it.each(['none', 'widget'] as const)('has not signed in (%s)', async (signIn) => {
    const id = await seedPerson({ role: 'user', signIn })
    expect(await getPortalUserDetail(id)).toMatchObject({ hasSignedIn: false })
  })

  it('a teammate is found only when teammates are included, with their role', async () => {
    const id = await seedPerson({ role: 'member', signIn: 'account' })
    await assign(id, await systemRoleId(SYSTEM_ROLES.MANAGER))

    expect(await getPortalUserDetail(id)).toBeNull()
    const detail = await getPortalUserDetail(id, { includeTeammates: true })
    expect(detail?.teamRole).toEqual({ role: 'member' })
    expect(detail?.hasSignedIn).toBe(true)
  })

  it('an admin on the Owner preset reports plain admin', async () => {
    const id = await seedPerson({ role: 'admin' })
    await assign(id, await systemRoleId(SYSTEM_ROLES.OWNER))

    const detail = await getPortalUserDetail(id, { includeTeammates: true })
    expect(detail?.teamRole).toEqual({ role: 'admin' })
  })

  it('a member holding a custom role reports its id and name', async () => {
    const id = await seedPerson({ role: 'member' })
    const customRoleId = createId('role') as RoleId
    await testDb
      .insert(roles)
      .values({ id: customRoleId, key: customRoleId, name: 'Support lead', isSystem: false })
    await assign(id, customRoleId)

    const detail = await getPortalUserDetail(id, { includeTeammates: true })
    expect(detail?.teamRole).toEqual({
      role: 'member',
      roleId: customRoleId,
      roleName: 'Support lead',
    })
  })

  it('never returns a support principal', async () => {
    const id = await seedPerson({ role: 'admin', type: 'support' })
    expect(await getPortalUserDetail(id, { includeTeammates: true })).toBeNull()
  })
})
