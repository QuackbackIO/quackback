/**
 * Real-Postgres coverage for SSO role rules that grant a workspace role.
 *
 * A matched rule naming a custom role assigns it the way every custom grant
 * lands: the member tier on the principal plus a workspace assignment carrying
 * the role. Under sync, a person whose rule now names another role moves to
 * it. A rule naming a role that has since been deleted grants its plain tier
 * and logs a warning.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { and, eq, isNull, principal, principalRoleAssignments, roles, user } from '@/lib/server/db'
import { SYSTEM_ROLES } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({
  warn: vi.fn(),
  recordAuditEvent: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn(),
}))
vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: vi.fn(async () => {}),
}))
vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: hoisted.recordAuditEvent }))
vi.mock('@/lib/server/logger', () => {
  const child = () => ({
    warn: hoisted.warn,
    info: () => {},
    debug: () => {},
    error: () => {},
    child,
  })
  return { logger: { child, warn: hoisted.warn, info: () => {}, debug: () => {}, error: () => {} } }
})

const { handleAutoProvisionAfter } = await import('../hooks')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roles.id }).from(roles).limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
  },
})

if (fixture.available) {
  beforeEach(() => {
    hoisted.warn.mockClear()
    hoisted.recordAuditEvent.mockClear()
    return fixture.begin()
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedUser(role: 'admin' | 'member' | 'user' | null, assignRoleId?: RoleId) {
  const userId = createId('user') as UserId
  const email = `p-${suffix()}@elsewhere.test`
  await testDb.insert(user).values({ id: userId, name: 'P', email })
  let principalId: PrincipalId | null = null
  if (role) {
    principalId = createId('principal') as PrincipalId
    await testDb
      .insert(principal)
      .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
    if (assignRoleId) {
      await testDb.insert(principalRoleAssignments).values({ principalId, roleId: assignRoleId })
    }
  }
  return { userId, email, principalId }
}

async function insertRole(name: string): Promise<RoleId> {
  const id = createId('role') as RoleId
  await testDb.insert(roles).values({ id, key: id, name, isSystem: false })
  return id
}

async function state(userId: UserId) {
  const [p] = await testDb.select().from(principal).where(eq(principal.userId, userId))
  if (!p) return null
  const rows = await testDb
    .select({ roleId: principalRoleAssignments.roleId })
    .from(principalRoleAssignments)
    .where(
      and(eq(principalRoleAssignments.principalId, p.id), isNull(principalRoleAssignments.teamId))
    )
  return { role: p.role, assignments: rows.map((r) => r.roleId) }
}

async function signIn(
  who: { userId: UserId; email: string },
  rules: Array<{ whenContains: string; role: 'admin' | 'member' | 'user'; roleId?: string }>,
  groups: string[],
  syncOnEverySignIn = false
) {
  await handleAutoProvisionAfter(
    {
      path: '/callback/:id',
      params: { id: 'oidc_x' },
      context: { newSession: { user: { id: who.userId, email: who.email } } },
    },
    [
      {
        id: 'idp_x',
        registrationId: 'oidc_x',
        enabled: true,
        autoCreateUsers: true,
        autoProvisionRole: null,
        claimMapping: {
          role: { claimPath: 'groups', rules, ...(syncOnEverySignIn ? { syncOnEverySignIn } : {}) },
        },
        domains: [],
      },
    ] as unknown as Parameters<typeof handleAutoProvisionAfter>[1],
    new Set(['oidc_x']),
    async () => ({ claims: { groups } }) as never
  )
}

describe.skipIf(!fixture.available)('SSO role rules granting a workspace role', () => {
  it('a first sign-in matching a custom-role rule gets the member tier and that role', async () => {
    const support = await insertRole('Support')
    const who = await seedUser('user')
    await signIn(who, [{ whenContains: 'support', role: 'member', roleId: support }], ['support'])
    expect(await state(who.userId)).toEqual({ role: 'member', assignments: [support] })
  })

  it('a returning person with no principal is rebuilt with the custom role', async () => {
    const support = await insertRole('Support')
    const who = await seedUser(null)
    await signIn(who, [{ whenContains: 'support', role: 'member', roleId: support }], ['support'])
    expect(await state(who.userId)).toEqual({ role: 'member', assignments: [support] })
  })

  it('under sync, a person whose rule now names another role moves to it, audited', async () => {
    const support = await insertRole('Support')
    const billing = await insertRole('Billing')
    const who = await seedUser('member', support)
    // Without sync an existing member is left alone.
    await signIn(who, [{ whenContains: 'support', role: 'member', roleId: billing }], ['support'])
    expect(await state(who.userId)).toEqual({ role: 'member', assignments: [support] })
    expect(hoisted.recordAuditEvent).not.toHaveBeenCalled()

    await signIn(
      who,
      [{ whenContains: 'support', role: 'member', roleId: billing }],
      ['support'],
      true
    )
    expect(await state(who.userId)).toEqual({ role: 'member', assignments: [billing] })
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.role.changed',
        before: { role: 'member', assignedRole: 'Support' },
        after: { role: 'member', assignedRole: 'Billing' },
        metadata: { source: 'claim_mapping' },
      })
    )
  })

  it('under sync, an admin matching a custom-role rule moves to it', async () => {
    const support = await insertRole('Support')
    // A second admin, so the last-admin rail does not refuse the demotion.
    await seedUser('admin')
    const owner = await testDb.select().from(roles).where(eq(roles.key, SYSTEM_ROLES.OWNER))
    const who = await seedUser('admin', owner[0]?.id as RoleId | undefined)
    await signIn(
      who,
      [{ whenContains: 'support', role: 'member', roleId: support }],
      ['support'],
      true
    )
    expect(await state(who.userId)).toEqual({ role: 'member', assignments: [support] })
  })

  it('a matched rule naming a deleted role grants nothing, stops there, and warns without personal data', async () => {
    const who = await seedUser('user')
    const gone = createId('role')
    // The later rule would match too; first match wins, so it never applies.
    await signIn(
      who,
      [
        { whenContains: 'support', role: 'member', roleId: gone },
        { whenContains: 'support', role: 'admin' },
      ],
      ['support']
    )
    expect(await state(who.userId)).toEqual({ role: 'user', assignments: [] })
    expect(hoisted.warn).toHaveBeenCalledTimes(1)
    const [ctx] = hoisted.warn.mock.calls[0] as [Record<string, unknown>, string]
    expect(ctx).toMatchObject({ code: 'sso_role_rule_role_missing', role_id: gone, rule_index: 0 })
    expect(JSON.stringify(ctx)).not.toContain(who.email)
  })

  it('under sync, a deleted or Owner role leaves the person exactly as they are', async () => {
    // A second admin, so a demotion would not be refused by the last-admin rail.
    await seedUser('admin')
    const [owner] = await testDb.select().from(roles).where(eq(roles.key, SYSTEM_ROLES.OWNER))
    const who = await seedUser('admin', owner!.id as RoleId)
    for (const roleId of [createId('role'), owner!.id]) {
      await signIn(who, [{ whenContains: 'support', role: 'member', roleId }], ['support'], true)
      expect(await state(who.userId)).toEqual({ role: 'admin', assignments: [owner!.id] })
    }
    expect(hoisted.recordAuditEvent).not.toHaveBeenCalled()
    expect(hoisted.warn).toHaveBeenCalledTimes(2)
  })
})
