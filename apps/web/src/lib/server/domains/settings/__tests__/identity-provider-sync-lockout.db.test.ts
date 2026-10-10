/**
 * Real-Postgres coverage for the sync lockout guard.
 *
 * With sync on, every sign-in through the provider re-applies its roles. If no
 * rule can give a role that manages SSO and the default role is not admin, a
 * teammate who manages SSO today and signs in from one of the provider's
 * verified domains is demoted on their next sign-in, and nobody may be left
 * able to fix the page. The save is refused instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type IdentityProviderId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  account,
  eq,
  identityProvider,
  permissions,
  principal,
  rolePermissions,
  roles,
  ssoVerifiedDomain,
  user,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import { ValidationError } from '@/lib/shared/errors'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/auth', () => ({ resetAuth: vi.fn() }))
vi.mock('../settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings.helpers')>()),
  invalidateSettingsCache: vi.fn(async () => {}),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => null),
  deletePlatformCredentials: vi.fn(async () => {}),
  getConfiguredIntegrationTypes: vi.fn(async () => new Set<string>()),
  hasPlatformCredentials: vi.fn(async () => false),
}))

import {
  saveIdentityProviderClaimMapping,
  upsertIdentityProvider,
} from '../identity-providers.service'
import { roleRuleGrantCheck } from '@/lib/server/domains/roles/role.rule-grants'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roles.id }).from(roles).limit(0)
    await db.select({ id: identityProvider.id }).from(identityProvider).limit(0)
  },
})

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

const suffix = () => Math.random().toString(36).slice(2, 10)
const check = roleRuleGrantCheck(ALL_PERMISSIONS)
const MEMBER_ONLY = {
  role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
}

async function insertProvider(opts: {
  claimMapping?: unknown
  autoProvisionRole?: 'admin' | 'member' | 'user' | null
}) {
  const registrationId = `oidc_${suffix()}`
  const [row] = await testDb
    .insert(identityProvider)
    .values({
      registrationId,
      label: 'IdP',
      clientId: 'c',
      enabled: false,
      autoProvisionRole: opts.autoProvisionRole ?? null,
      claimMapping: (opts.claimMapping ?? null) as never,
    })
    .returning()
  const id = row!.id as IdentityProviderId
  const domain = `acme-${suffix()}.com`
  await testDb
    .insert(ssoVerifiedDomain)
    .values({ name: domain, verificationToken: 't', verifiedAt: new Date(), providerId: id })
  return { id, registrationId, domain, claimMapping: row!.claimMapping }
}

async function seedAdmin(
  idp: { registrationId: string; domain: string },
  email = `a-${suffix()}@${idp.domain}`
) {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: 'A', email })
  await testDb.insert(principal).values({
    id: createId('principal'),
    userId,
    role: 'admin',
    type: 'user',
    createdAt: new Date(),
  })
  await testDb.insert(account).values({
    accountId: `sub-${suffix()}`,
    providerId: idp.registrationId,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function insertRole(keys: readonly string[]): Promise<RoleId> {
  const id = createId('role') as RoleId
  await testDb.insert(roles).values({ id, key: id, name: 'Custom', isSystem: false })
  const rows = await testDb.select({ id: permissions.id, key: permissions.key }).from(permissions)
  const wanted = rows.filter((r) => keys.includes(r.key))
  await testDb
    .insert(rolePermissions)
    .values(wanted.map((p) => ({ roleId: id, permissionId: p.id })))
  return id
}

const turnSyncOn = (idp: { id: IdentityProviderId; claimMapping: unknown }, extra: object[] = []) =>
  saveIdentityProviderClaimMapping(idp.id, {
    expectedClaimMapping: idp.claimMapping,
    operations: [...(extra as never[]), { op: 'setRoleSync', syncOnEverySignIn: true }],
    checkRoleGrants: check,
    acknowledgeAdminRules: true,
  })

describe.skipIf(!fixture.available)('sync lockout guard', () => {
  it('refuses turning sync on when it would demote the people who manage SSO', async () => {
    const idp = await insertProvider({ claimMapping: MEMBER_ONLY })
    await seedAdmin(idp)
    await seedAdmin(idp)
    const err = await turnSyncOn(idp).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).code).toBe('SYNC_LOCKOUT')
    expect((err as ValidationError).message).toContain('2 people')
    const [row] = await testDb
      .select()
      .from(identityProvider)
      .where(eq(identityProvider.id, idp.id))
    expect(row!.claimMapping).toEqual(MEMBER_ONLY)
  })

  it('allows it when a rule, the default role or the domain keeps them safe', async () => {
    // Baseline: refused.
    const base = await insertProvider({ claimMapping: MEMBER_ONLY })
    await seedAdmin(base)
    expect(await turnSyncOn(base).catch((e: unknown) => (e as ValidationError).code)).toBe(
      'SYNC_LOCKOUT'
    )

    // A rule that gives admin.
    const withAdminRule = await insertProvider({ claimMapping: MEMBER_ONLY })
    await seedAdmin(withAdminRule)
    await turnSyncOn(withAdminRule, [
      { op: 'insertRoleRule', index: 0, rule: { whenContains: 'admins', role: 'admin' } },
    ])

    // A rule that gives a workspace role able to manage SSO.
    const sso = await insertRole([PERMISSIONS.AUTH_MANAGE])
    const withSsoRole = await insertProvider({ claimMapping: MEMBER_ONLY })
    await seedAdmin(withSsoRole)
    await turnSyncOn(withSsoRole, [
      {
        op: 'insertRoleRule',
        index: 0,
        rule: { whenContains: 'it', role: 'member', roleId: sso },
      },
    ])

    // The default role is admin.
    const adminDefault = await insertProvider({
      claimMapping: MEMBER_ONLY,
      autoProvisionRole: 'admin',
    })
    await seedAdmin(adminDefault)
    await turnSyncOn(adminDefault)

    // The admin signs in from outside the verified domains and matches no rule.
    const offDomain = await insertProvider({ claimMapping: MEMBER_ONLY })
    await seedAdmin(offDomain, `a-${suffix()}@elsewhere.com`)
    await turnSyncOn(offDomain)
  })

  it('the whole-provider save refuses a default-role change that locks them out', async () => {
    const synced = { role: { ...MEMBER_ONLY.role, syncOnEverySignIn: true } }
    const idp = await insertProvider({ claimMapping: synced, autoProvisionRole: 'admin' })
    await seedAdmin(idp)
    const err = await upsertIdentityProvider({
      id: idp.id,
      registrationId: idp.registrationId,
      label: 'IdP',
      clientId: 'c',
      autoProvisionRole: 'member',
      checkRoleGrants: check,
    }).catch((e: unknown) => e)
    expect((err as ValidationError).code).toBe('SYNC_LOCKOUT')
  })
})
