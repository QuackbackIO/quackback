/**
 * Real-Postgres coverage for promoting a signed-in portal user through
 * updateMemberRole, the path behind the members "Add people" dialog, the
 * single-row server fn, and REST PATCH /principals/:id. A portal user who has
 * signed in joins the team at once; everyone else (never signed in, widget
 * only, anonymous, support) is refused. Seats and the admin grant ceiling
 * apply to promotion and to ordinary role changes alike, and the undo path
 * (removeTeamMember) puts a just-promoted person back.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  account,
  and,
  auditLog,
  eq,
  invitation,
  isNull,
  principal,
  principalRoleAssignments,
  roles,
  session,
  settings,
  user,
} from '@/lib/server/db'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import { countSeatUsage } from '../seat-usage'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: vi.fn(async () => {}),
}))

const { updateMemberRole, removeTeamMember } = await import('../principal.service')
const { invalidateTierLimitsCache } =
  await import('@/lib/server/domains/settings/tier-limits.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id, type: principal.type }).from(principal).limit(0)
    await db.select({ id: account.id }).from(account).limit(0)
    await db.select({ id: session.id, scope: session.scope }).from(session).limit(0)
    await db.select({ id: settings.id, tierLimits: settings.tierLimits }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type Seeded = { userId: UserId; principalId: PrincipalId }

async function seedPerson(opts: {
  role: 'admin' | 'member' | 'user'
  type?: 'user' | 'anonymous' | 'support'
  signIn?:
    | 'account'
    | 'portal-session'
    | 'widget-session'
    | 'email-signin-audit'
    | 'anonymous-signin-audit'
    | 'none'
}): Promise<Seeded & { email: string }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const email = `p-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: `P ${suffix()}`, email })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.role,
    type: opts.type ?? 'user',
    createdAt: new Date(),
  })
  const signIn = opts.signIn ?? 'account'
  if (signIn === 'account') {
    await testDb
      .insert(account)
      .values({ accountId: `sub-${suffix()}`, providerId: 'steam', userId, updatedAt: new Date() })
  } else if (signIn === 'portal-session' || signIn === 'widget-session') {
    await testDb.insert(session).values({
      id: `sess-${suffix()}`,
      token: `tok-${suffix()}`,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
      scope: signIn === 'widget-session' ? 'widget' : 'portal',
    })
  } else if (signIn === 'email-signin-audit' || signIn === 'anonymous-signin-audit') {
    // A sign-in whose session is gone (signed out or revoked): only the
    // sign-in record remains. Email sign-ins leave no account row.
    await testDb.insert(auditLog).values({
      eventType: 'auth.signin.success',
      actorUserId: userId,
      metadata: { method: signIn === 'email-signin-audit' ? 'magic-link' : 'anonymous' },
    })
  }
  return { userId, principalId, email }
}

async function seedPendingInvite(email: string, inviterId: UserId) {
  const id = createId('invite')
  await testDb.insert(invitation).values({
    id,
    email,
    role: 'member',
    status: 'pending',
    expiresAt: new Date(Date.now() + 86_400_000),
    inviterId,
    createdAt: new Date(),
    magicLinkTokens: [`tok-${id}`],
  })
  return id
}

async function inviteStatus(id: string) {
  const [row] = await testDb
    .select()
    .from(invitation)
    .where(eq(invitation.id, id as never))
  return row.status
}

/** Set the workspace seat cap to `used + free` so exactly `free` seats remain. */
async function setFreeSeats(free: number) {
  const { used } = await countSeatUsage(testDb)
  const tierLimits = JSON.stringify({ maxTeamSeats: used + free })
  const existing = await testDb.select({ id: settings.id }).from(settings)
  if (existing.length === 0) {
    await testDb.insert(settings).values({
      id: createId('workspace'),
      name: 'Acme',
      slug: `acme-${suffix()}`,
      createdAt: new Date(),
      tierLimits,
    })
  } else {
    await testDb.update(settings).set({ tierLimits }).where(eq(settings.id, existing[0].id))
  }
  invalidateTierLimitsCache()
}

async function roleOf(principalId: PrincipalId) {
  const [row] = await testDb.select().from(principal).where(eq(principal.id, principalId))
  return row.role
}

async function auditRows(principalId: PrincipalId) {
  return testDb.select().from(auditLog).where(eq(auditLog.targetId, principalId))
}

const actor = { userId: null, email: 'admin@example.com', role: 'admin', type: 'user' as const }

if (fixture.available) {
  beforeEach(async () => {
    await fixture.begin()
    await setFreeSeats(100)
  })
  afterEach(() => {
    invalidateTierLimitsCache()
    return fixture.rollback()
  })
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('updateMemberRole: promoting a portal user', () => {
  it('adds a signed-in portal user to the team at once, audited as a role change', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'user', signIn: 'account' })

    await updateMemberRole(target.principalId, 'member', admin.principalId, actor, undefined, {
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'admin',
    })

    expect(await roleOf(target.principalId)).toBe('member')
    const rows = await auditRows(target.principalId)
    expect(rows.map((r) => r.eventType)).toEqual(['user.role.changed'])
    expect(rows[0].beforeValue).toEqual({ role: 'user' })
    expect(rows[0].afterValue).toEqual({ role: 'member' })
  })

  it('counts a portal sign-in session as signed in', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'user', signIn: 'portal-session' })

    await updateMemberRole(target.principalId, 'admin', admin.principalId, actor, undefined, {
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'admin',
    })

    expect(await roleOf(target.principalId)).toBe('admin')
  })

  it('grants a custom role on promotion', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'user' })
    const customRoleId = createId('role') as RoleId
    await testDb
      .insert(roles)
      .values({ id: customRoleId, key: customRoleId, name: 'Custom', isSystem: false })

    await updateMemberRole(target.principalId, 'member', admin.principalId, actor, undefined, {
      assignRoleId: customRoleId,
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'admin',
    })

    expect(await roleOf(target.principalId)).toBe('member')
    const assigned = await testDb
      .select({ roleId: principalRoleAssignments.roleId })
      .from(principalRoleAssignments)
      .where(
        and(
          eq(principalRoleAssignments.principalId, target.principalId),
          isNull(principalRoleAssignments.teamId)
        )
      )
    expect(assigned.map((a) => a.roleId)).toEqual([customRoleId])
  })

  it.each(['none', 'widget-session'] as const)(
    'refuses a portal user who has not signed in (%s) and leaves them unchanged',
    async (signIn) => {
      const admin = await seedPerson({ role: 'admin' })
      const target = await seedPerson({ role: 'user', signIn })

      await expect(
        updateMemberRole(target.principalId, 'member', admin.principalId, actor, undefined, {
          granterPermissions: ALL_PERMISSIONS,
          granterRole: 'admin',
        })
      ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' })
      expect(await roleOf(target.principalId)).toBe('user')
    }
  )

  it.each(['anonymous', 'support'] as const)('never promotes a %s principal', async (type) => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: type === 'support' ? 'admin' : 'user', type })

    await expect(
      updateMemberRole(target.principalId, 'member', admin.principalId, actor, undefined, {
        granterPermissions: ALL_PERMISSIONS,
        granterRole: 'admin',
      })
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' })
  })

  it('needs a free seat; with none, nothing changes and the error states needed and free', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'user' })
    await setFreeSeats(0)

    await expect(
      updateMemberRole(target.principalId, 'member', admin.principalId, actor, undefined, {
        granterPermissions: ALL_PERMISSIONS,
        granterRole: 'admin',
      })
    ).rejects.toMatchObject({
      code: 'SEAT_LIMIT',
      message: expect.stringMatching(/needs 1.*0 are free/),
    })
    expect(await roleOf(target.principalId)).toBe('user')
    expect(await auditRows(target.principalId)).toEqual([])
  })

  it('a role change between teammates takes no extra seat', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'member' })
    await setFreeSeats(0)

    await updateMemberRole(target.principalId, 'admin', admin.principalId, actor, undefined, {
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'admin',
    })
    expect(await roleOf(target.principalId)).toBe('admin')
  })
})

describe.skipIf(!fixture.available)('updateMemberRole: only an admin grants Admin', () => {
  it('refuses a non-admin promoting a portal user to admin', async () => {
    const manager = await seedPerson({ role: 'member' })
    const target = await seedPerson({ role: 'user' })

    await expect(
      updateMemberRole(target.principalId, 'admin', manager.principalId, actor, undefined, {
        granterPermissions: ALL_PERMISSIONS,
        granterRole: 'member',
      })
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' })
    expect(await roleOf(target.principalId)).toBe('user')
  })

  it('refuses a non-admin raising a teammate to admin', async () => {
    const manager = await seedPerson({ role: 'member' })
    const target = await seedPerson({ role: 'member' })

    await expect(
      updateMemberRole(target.principalId, 'admin', manager.principalId, actor, undefined, {
        granterPermissions: ALL_PERMISSIONS,
        granterRole: 'member',
      })
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' })
    expect(await roleOf(target.principalId)).toBe('member')
  })

  it('fails closed when the granter role is not supplied for an admin grant', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'member' })

    await expect(
      updateMemberRole(target.principalId, 'admin', admin.principalId, actor, undefined, {
        granterPermissions: ALL_PERMISSIONS,
      })
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' })
  })

  it('lets a non-admin add a portal user as a member', async () => {
    const manager = await seedPerson({ role: 'member' })
    const target = await seedPerson({ role: 'user' })

    await updateMemberRole(target.principalId, 'member', manager.principalId, actor, undefined, {
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'member',
    })
    expect(await roleOf(target.principalId)).toBe('member')
  })
})

describe.skipIf(!fixture.available)('undo: removing someone just promoted', () => {
  it('puts them back to a portal user, clears the grant and audits the removal', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'user' })

    await updateMemberRole(target.principalId, 'admin', admin.principalId, actor, undefined, {
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'admin',
    })
    await removeTeamMember(target.principalId, admin.principalId, actor, undefined, {
      granterRole: 'admin',
    })

    expect(await roleOf(target.principalId)).toBe('user')
    const assigned = await testDb
      .select()
      .from(principalRoleAssignments)
      .where(eq(principalRoleAssignments.principalId, target.principalId))
    expect(assigned).toEqual([])
    const rows = await auditRows(target.principalId)
    expect(rows.map((r) => r.eventType).sort()).toEqual(['user.removed', 'user.role.changed'])
  })
})

describe.skipIf(!fixture.available)('signed in by email, with no live session', () => {
  it('counts a recorded email sign-in as signed in', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'user', signIn: 'email-signin-audit' })

    await updateMemberRole(target.principalId, 'member', admin.principalId, actor, undefined, {
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'admin',
    })
    expect(await roleOf(target.principalId)).toBe('member')
  })

  it('does not count an anonymous widget sign-in', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'user', signIn: 'anonymous-signin-audit' })

    await expect(
      updateMemberRole(target.principalId, 'member', admin.principalId, actor, undefined, {
        granterPermissions: ALL_PERMISSIONS,
        granterRole: 'admin',
      })
    ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' })
  })
})

describe.skipIf(!fixture.available)('a pending team invite for the person', () => {
  it('reuses the invite seat and retires the invite in the same write', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'user' })
    const inviteId = await seedPendingInvite(target.email, admin.userId)
    await setFreeSeats(0) // the pending invite already holds their seat

    await updateMemberRole(target.principalId, 'admin', admin.principalId, actor, undefined, {
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'admin',
    })

    expect(await roleOf(target.principalId)).toBe('admin')
    expect(await inviteStatus(inviteId)).toBe('canceled')
    expect((await countSeatUsage(testDb)).pendingInvites).toBe(0)
  })
})

describe.skipIf(!fixture.available)('only an admin changes or removes an admin', () => {
  it('refuses a non-admin demoting an admin', async () => {
    const manager = await seedPerson({ role: 'member' })
    await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'admin' })

    await expect(
      updateMemberRole(target.principalId, 'member', manager.principalId, actor, undefined, {
        granterPermissions: ALL_PERMISSIONS,
        granterRole: 'member',
      })
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' })
    expect(await roleOf(target.principalId)).toBe('admin')
  })

  it('refuses a non-admin removing an admin, and fails closed without a granter role', async () => {
    const manager = await seedPerson({ role: 'member' })
    await seedPerson({ role: 'admin' })
    const target = await seedPerson({ role: 'admin' })

    await expect(
      removeTeamMember(target.principalId, manager.principalId, actor, undefined, {
        granterRole: 'member',
      })
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' })
    await expect(
      removeTeamMember(target.principalId, manager.principalId, actor)
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' })
    expect(await roleOf(target.principalId)).toBe('admin')
  })

  it('lets an admin demote and remove an admin, keeping the last-admin guard', async () => {
    const admin = await seedPerson({ role: 'admin' })
    const other = await seedPerson({ role: 'admin' })

    await updateMemberRole(other.principalId, 'member', admin.principalId, actor, undefined, {
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'admin',
    })
    expect(await roleOf(other.principalId)).toBe('member')
    await expect(
      removeTeamMember(admin.principalId, other.principalId, actor, undefined, {
        granterRole: 'admin',
      })
    ).rejects.toMatchObject({ code: 'LAST_ADMIN' })
  })

  it('lets a non-admin remove a member', async () => {
    const manager = await seedPerson({ role: 'member' })
    const target = await seedPerson({ role: 'member' })

    await removeTeamMember(target.principalId, manager.principalId, actor, undefined, {
      granterRole: 'member',
    })
    expect(await roleOf(target.principalId)).toBe('user')
  })
})
