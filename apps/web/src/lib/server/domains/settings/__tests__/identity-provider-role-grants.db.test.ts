/**
 * Real-Postgres coverage for saving role rules that grant a workspace role.
 *
 * Saving such a rule is a grant: every person who matches it will hold that
 * role, so the saving admin is held to the same ceiling as a direct role
 * change. The role must exist, must not be the Owner preset, and its bundle
 * must sit within the saver's own permissions. A rule granting an admin-tier
 * bundle needs the same acknowledgement as an admin rule.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type IdentityProviderId, type RoleId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, identityProvider, permissions, rolePermissions, roles } from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

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

async function insertRole(keys: readonly string[]): Promise<RoleId> {
  const id = createId('role') as RoleId
  await testDb.insert(roles).values({ id, key: id, name: `Custom ${id}`, isSystem: false })
  if (keys.length > 0) {
    const rows = await testDb.select({ id: permissions.id, key: permissions.key }).from(permissions)
    const wanted = rows.filter((r) => keys.includes(r.key))
    await testDb
      .insert(rolePermissions)
      .values(wanted.map((p) => ({ roleId: id, permissionId: p.id })))
  }
  return id
}

async function presetId(key: string): Promise<RoleId> {
  const [row] = await testDb.select({ id: roles.id }).from(roles).where(eq(roles.key, key))
  return row!.id as RoleId
}

async function insertProvider(claimMapping: unknown = null): Promise<IdentityProviderId> {
  const [row] = await testDb
    .insert(identityProvider)
    .values({
      registrationId: `oidc_${Math.random().toString(36).slice(2, 10)}`,
      label: 'Test IdP',
      clientId: 'client',
      enabled: false,
      claimMapping: claimMapping as never,
    })
    .returning()
  return row!.id as IdentityProviderId
}

const insertRule = (roleId: string, whenContains = 'support') => ({
  op: 'insertRoleRule' as const,
  index: 0,
  rule: { whenContains, role: 'member' as const, roleId },
})

async function storedRules(id: IdentityProviderId) {
  const [row] = await testDb.select().from(identityProvider).where(eq(identityProvider.id, id))
  return (row!.claimMapping as { role?: { rules: unknown[] } } | null)?.role?.rules
}

describe.skipIf(!fixture.available)('saving role rules that grant a workspace role', () => {
  it('saves a grantable custom role', async () => {
    const support = await insertRole([PERMISSIONS.CONVERSATION_VIEW])
    const id = await insertProvider()
    await saveIdentityProviderClaimMapping(id, {
      expectedClaimMapping: null,
      operations: [insertRule(support)],
      checkRoleGrants: roleRuleGrantCheck([PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.AUTH_MANAGE]),
    })
    expect(await storedRules(id)).toEqual([
      { whenContains: 'support', role: 'member', roleId: support },
    ])
  })

  it('refuses a role that does not exist', async () => {
    const id = await insertProvider()
    const err = await saveIdentityProviderClaimMapping(id, {
      expectedClaimMapping: null,
      operations: [insertRule(createId('role'))],
      checkRoleGrants: roleRuleGrantCheck(ALL_PERMISSIONS),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).code).toBe('ROLE_RULE_UNKNOWN_ROLE')
    expect(await storedRules(id)).toBeUndefined()
  })

  it('refuses a role whose bundle exceeds what the saver holds', async () => {
    const billing = await insertRole([PERMISSIONS.BILLING_MANAGE])
    const id = await insertProvider()
    const err = await saveIdentityProviderClaimMapping(id, {
      expectedClaimMapping: null,
      operations: [insertRule(billing)],
      checkRoleGrants: roleRuleGrantCheck([PERMISSIONS.AUTH_MANAGE]),
      acknowledgeAdminRules: true,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ForbiddenError)
    expect(await storedRules(id)).toBeUndefined()
  })

  it('refuses the Owner preset', async () => {
    const owner = await presetId(SYSTEM_ROLES.OWNER)
    const id = await insertProvider()
    await expect(
      saveIdentityProviderClaimMapping(id, {
        expectedClaimMapping: null,
        operations: [insertRule(owner)],
        checkRoleGrants: roleRuleGrantCheck(ALL_PERMISSIONS),
        acknowledgeAdminRules: true,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('fails closed when no grant check is supplied', async () => {
    const support = await insertRole([PERMISSIONS.CONVERSATION_VIEW])
    const id = await insertProvider()
    await expect(
      saveIdentityProviderClaimMapping(id, {
        expectedClaimMapping: null,
        operations: [insertRule(support)],
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('a rule granting an admin-tier role needs the admin acknowledgement', async () => {
    const admin = await presetId(SYSTEM_ROLES.ADMIN)
    const id = await insertProvider()
    const err = await saveIdentityProviderClaimMapping(id, {
      expectedClaimMapping: null,
      operations: [insertRule(admin)],
      checkRoleGrants: roleRuleGrantCheck(ALL_PERMISSIONS),
    }).catch((e: unknown) => e)
    expect((err as ValidationError).code).toBe('MAPPING_ADMIN_ACK_REQUIRED')

    await saveIdentityProviderClaimMapping(id, {
      expectedClaimMapping: null,
      operations: [insertRule(admin)],
      checkRoleGrants: roleRuleGrantCheck(ALL_PERMISSIONS),
      acknowledgeAdminRules: true,
    })
    expect(await storedRules(id)).toEqual([
      { whenContains: 'support', role: 'member', roleId: admin },
    ])
  })

  it('an unchanged rule naming a deleted role does not block other edits, a new one does', async () => {
    const gone = createId('role')
    const stored = {
      role: { claimPath: 'groups', rules: [{ whenContains: 'old', role: 'member', roleId: gone }] },
    }
    const id = await insertProvider(stored)
    const support = await insertRole([PERMISSIONS.CONVERSATION_VIEW])
    await saveIdentityProviderClaimMapping(id, {
      expectedClaimMapping: stored,
      operations: [{ ...insertRule(support, 'new'), index: 1 }],
      checkRoleGrants: roleRuleGrantCheck([PERMISSIONS.CONVERSATION_VIEW]),
    })
    expect(await storedRules(id)).toEqual([
      { whenContains: 'old', role: 'member', roleId: gone },
      { whenContains: 'new', role: 'member', roleId: support },
    ])
  })

  it('the whole-provider save path checks the grant too', async () => {
    const billing = await insertRole([PERMISSIONS.BILLING_MANAGE])
    const err = await upsertIdentityProvider({
      registrationId: `oidc_${Math.random().toString(36).slice(2, 10)}`,
      label: 'Test IdP',
      clientId: 'client',
      enabled: false,
      claimMapping: {
        role: {
          claimPath: 'groups',
          rules: [{ whenContains: 'billing', role: 'member', roleId: billing }],
        },
      },
      acknowledgeAdminRules: true,
      checkRoleGrants: roleRuleGrantCheck([PERMISSIONS.AUTH_MANAGE]),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ForbiddenError)
  })

  it('any change to the role section needs every role the rules give to be grantable', async () => {
    const billing = await insertRole([PERMISSIONS.BILLING_MANAGE])
    const stored = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'eng', role: 'member' },
          { whenContains: 'billing', role: 'member', roleId: billing },
        ],
      },
    }
    const id = await insertProvider(stored)
    const check = roleRuleGrantCheck([PERMISSIONS.AUTH_MANAGE])
    // A change outside the role section grants nothing new.
    await saveIdentityProviderClaimMapping(id, {
      expectedClaimMapping: stored,
      operations: [{ op: 'setProfileSync', syncOnSignIn: true }],
      checkRoleGrants: check,
      acknowledgeAdminRules: true,
    })
    const [row] = await testDb.select().from(identityProvider).where(eq(identityProvider.id, id))
    for (const op of [
      { op: 'setRoleSync' as const, syncOnEverySignIn: true },
      { op: 'reorderRoleRule' as const, from: 1, to: 0 },
      { op: 'setRolePath' as const, claimPath: 'roles' },
      { op: 'removeRoleRule' as const, index: 0 },
    ]) {
      const err = await saveIdentityProviderClaimMapping(id, {
        expectedClaimMapping: row!.claimMapping,
        operations: [op],
        checkRoleGrants: check,
        acknowledgeAdminRules: true,
      }).catch((e: unknown) => e)
      expect(err, op.op).toBeInstanceOf(ForbiddenError)
    }
  })
})
