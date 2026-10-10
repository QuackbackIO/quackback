/**
 * Real-Postgres coverage for the teammates who sign in through one identity
 * provider, and which of them hold admin-level access. The Roles card reads
 * this to warn before a rule change could lock the workspace's admins out.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type IdentityProviderId,
  type PrincipalId,
  type RoleId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  account,
  eq,
  identityProvider,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  ssoVerifiedDomain,
  user,
} from '@/lib/server/db'
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listProviderAdmins } from '../identity-provider-accounts'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: account.id }).from(account).limit(0)
    await db.select({ id: identityProvider.id }).from(identityProvider).limit(0)
  },
})

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

const suffix = () => Math.random().toString(36).slice(2, 10)

async function insertProvider(): Promise<{ id: IdentityProviderId; registrationId: string }> {
  const registrationId = `oidc_${suffix()}`
  const [row] = await testDb
    .insert(identityProvider)
    .values({ registrationId, label: 'IdP', clientId: 'c', enabled: false })
    .returning()
  return { id: row!.id as IdentityProviderId, registrationId }
}

async function insertRole(name: string, keys: readonly string[]): Promise<RoleId> {
  const id = createId('role') as RoleId
  await testDb.insert(roles).values({ id, key: id, name, isSystem: false })
  const rows = await testDb.select({ id: permissions.id, key: permissions.key }).from(permissions)
  const wanted = rows.filter((r) => keys.includes(r.key))
  if (wanted.length > 0) {
    await testDb
      .insert(rolePermissions)
      .values(wanted.map((p) => ({ roleId: id, permissionId: p.id })))
  }
  return id
}

async function seedPerson(opts: {
  providerId: string | null
  role: 'admin' | 'member' | 'user'
  type?: 'user' | 'support'
  name?: string
  email?: string
  displayName?: string | null
  assignRoleId?: RoleId
}) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: opts.name ?? 'Person',
    email: opts.email ?? `p-${suffix()}@example.com`,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.role,
    type: opts.type ?? 'user',
    displayName: opts.displayName ?? null,
    createdAt: new Date(),
  })
  if (opts.assignRoleId) {
    await testDb.insert(principalRoleAssignments).values({ principalId, roleId: opts.assignRoleId })
  }
  if (opts.providerId) {
    await testDb.insert(account).values({
      accountId: `sub-${suffix()}`,
      providerId: opts.providerId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
  return { userId, principalId }
}

describe.skipIf(!fixture.available)('listProviderAdmins', () => {
  it('lists the provider teammates with their tier, role and admin-level access', async () => {
    const idp = await insertProvider()
    const other = await insertProvider()
    const support = await insertRole('Support', [PERMISSIONS.CONVERSATION_VIEW])
    const ops = await insertRole('Ops', [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.AUTH_MANAGE])
    const people = await insertRole('People', [PERMISSIONS.MEMBER_MANAGE])
    const [owner] = await testDb.select().from(roles).where(eq(roles.key, SYSTEM_ROLES.OWNER))
    await testDb.insert(ssoVerifiedDomain).values([
      { name: 'example.com', verificationToken: 't1', verifiedAt: new Date(), providerId: idp.id },
      { name: 'pending.com', verificationToken: 't2', verifiedAt: null, providerId: idp.id },
    ])

    const admin = await seedPerson({
      providerId: idp.registrationId,
      role: 'admin',
      name: 'Ada',
      email: 'ada@example.com',
      assignRoleId: owner!.id as RoleId,
    })
    const agent = await seedPerson({
      providerId: idp.registrationId,
      role: 'member',
      name: 'Bo',
      displayName: 'Bo Agent',
      email: 'temp-x@anon.quackback.io',
      assignRoleId: support,
    })
    const opsLead = await seedPerson({
      providerId: idp.registrationId,
      role: 'member',
      name: 'Cy',
      email: 'cy@pending.com',
      assignRoleId: ops,
    })
    const hr = await seedPerson({
      providerId: idp.registrationId,
      role: 'member',
      name: 'Di',
      email: 'di@example.com',
      assignRoleId: people,
    })
    // Not teammates, or not through this provider: left out.
    await seedPerson({ providerId: idp.registrationId, role: 'user' })
    await seedPerson({ providerId: idp.registrationId, role: 'admin', type: 'support' })
    await seedPerson({ providerId: other.registrationId, role: 'admin' })
    await seedPerson({ providerId: null, role: 'admin' })

    const rows = await listProviderAdmins(idp.id, agent.principalId)
    const byId = new Map(rows.map((r) => [r.principalId, r]))
    expect(rows).toHaveLength(4)
    expect(byId.get(admin.principalId)).toEqual({
      principalId: admin.principalId,
      name: 'Ada',
      email: 'ada@example.com',
      role: 'admin',
      adminTier: true,
      canManageSso: true,
      atVerifiedDomain: true,
      isCaller: false,
    })
    expect(byId.get(agent.principalId)).toEqual({
      principalId: agent.principalId,
      name: 'Bo Agent',
      email: null,
      role: 'member',
      roleId: support,
      roleName: 'Support',
      adminTier: false,
      canManageSso: false,
      atVerifiedDomain: false,
      isCaller: true,
    })
    expect(byId.get(opsLead.principalId)).toMatchObject({
      role: 'member',
      roleId: ops,
      roleName: 'Ops',
      adminTier: true,
      canManageSso: true,
      atVerifiedDomain: false,
      isCaller: false,
    })
    // Admin-tier by bundle, but unable to fix SSO.
    expect(byId.get(hr.principalId)).toMatchObject({
      adminTier: true,
      canManageSso: false,
      atVerifiedDomain: true,
    })
  })

  it('a person with two identities at the provider is listed once', async () => {
    const idp = await insertProvider()
    const who = await seedPerson({ providerId: idp.registrationId, role: 'admin' })
    await testDb.insert(account).values({
      accountId: `sub-${suffix()}`,
      providerId: idp.registrationId,
      userId: who.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(await listProviderAdmins(idp.id, null)).toHaveLength(1)
  })
})
