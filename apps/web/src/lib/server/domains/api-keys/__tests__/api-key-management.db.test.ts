/**
 * Real-Postgres coverage for the key lists and the kind-and-owner limits on
 * changing a key.
 *
 * A teammate manages only their own personal keys. Key managers manage
 * workspace keys and may revoke any key, but never rename or rotate someone
 * else's personal key. The managers' list names each key's creator (marked
 * once they have left) and each workspace key's role.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { apiKeys, eq, permissions, principal, rolePermissions, roles, user } from '@/lib/server/db'
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ROLES,
  type PermissionKey,
} from '@/lib/shared/permissions'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'

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

import {
  createApiKey,
  setWorkspaceKeyRole,
  listPersonalApiKeys,
  revokeApiKey,
  rotateApiKey,
  updateApiKeyName,
} from '../api-key.service'
import { listManagedApiKeys, listWorkspaceKeyRoleOptions } from '../api-key-management'
import { removeTeamMember } from '@/lib/server/domains/principals/principal.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: apiKeys.id, kind: apiKeys.kind }).from(apiKeys).limit(0)
    await db.select({ id: roles.id }).from(roles).where(eq(roles.key, SYSTEM_ROLES.SUPPORT_LEAD))
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(role: 'admin' | 'member', name = `Teammate ${role}`) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email: `keys-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function systemRoleId(key: string): Promise<RoleId> {
  const [row] = await testDb.select({ id: roles.id }).from(roles).where(eq(roles.key, key))
  return row.id as RoleId
}

async function seedCustomRole(name: string, granted: PermissionKey[]): Promise<RoleId> {
  const roleId = createId('role') as RoleId
  await testDb.insert(roles).values({ id: roleId, key: roleId, name, isSystem: false })
  for (const key of granted) {
    const [row] = await testDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, key))
      .limit(1)
    await testDb.insert(rolePermissions).values({ roleId, permissionId: row.id })
  }
  return roleId
}

const ADMIN_GRANTER = { permissions: ALL_PERMISSIONS, role: 'admin' as const }

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('changing a key within its kind and owner', () => {
  it('lists only my own personal keys', async () => {
    const me = await seedTeammate('member')
    const other = await seedTeammate('member')
    const mine = await createApiKey({ name: 'Mine' }, me)
    await createApiKey({ name: 'Theirs' }, other)
    await createApiKey(
      { name: 'Workspace', kind: 'workspace', roleId: await systemRoleId(SYSTEM_ROLES.MANAGER) },
      me,
      ADMIN_GRANTER
    )

    const keys = await listPersonalApiKeys(me)
    expect(keys.map((k) => k.id)).toEqual([mine.apiKey.id])
  })

  it('does not find someone else’s key or a workspace key for the owner filter', async () => {
    const me = await seedTeammate('admin')
    const other = await seedTeammate('member')
    const theirs = await createApiKey({ name: 'Theirs' }, other)
    const workspace = await createApiKey(
      { name: 'Workspace', kind: 'workspace', roleId: await systemRoleId(SYSTEM_ROLES.MANAGER) },
      me,
      ADMIN_GRANTER
    )
    const own = { kind: 'personal' as const, createdById: me }

    for (const id of [theirs.apiKey.id, workspace.apiKey.id]) {
      await expect(rotateApiKey(id, own)).rejects.toThrow(NotFoundError)
      await expect(updateApiKeyName(id, 'Renamed', own)).rejects.toThrow(NotFoundError)
      await expect(revokeApiKey(id, own)).rejects.toThrow(NotFoundError)
    }

    const mine = await createApiKey({ name: 'Mine' }, me)
    await expect(updateApiKeyName(mine.apiKey.id, 'Renamed', own)).resolves.toMatchObject({
      name: 'Renamed',
    })
    await expect(rotateApiKey(mine.apiKey.id, own)).resolves.toHaveProperty('plainTextKey')
    await expect(revokeApiKey(mine.apiKey.id, own)).resolves.toBeUndefined()
  })

  it('does not rotate or rename a personal key through the workspace filter', async () => {
    const admin = await seedTeammate('admin')
    const other = await seedTeammate('member')
    const theirs = await createApiKey({ name: 'Theirs' }, other)
    const workspaceOnly = { kind: 'workspace' as const }

    await expect(rotateApiKey(theirs.apiKey.id, workspaceOnly)).rejects.toThrow(NotFoundError)
    await expect(updateApiKeyName(theirs.apiKey.id, 'X', workspaceOnly)).rejects.toThrow(
      NotFoundError
    )
    // Revoking stays open to any key.
    await expect(revokeApiKey(theirs.apiKey.id)).resolves.toBeUndefined()
    void admin
  })

  it('does not rename a revoked key', async () => {
    const me = await seedTeammate('member')
    const { apiKey } = await createApiKey({ name: 'Gone' }, me)
    await revokeApiKey(apiKey.id)
    await expect(updateApiKeyName(apiKey.id, 'Back')).rejects.toThrow(NotFoundError)
  })
})

describe.skipIf(!fixture.available)('the key managers’ list', () => {
  it('names the creator, marks one who left, and names a workspace key’s role', async () => {
    const ben = await seedTeammate('admin', 'Ben Ortiz')
    const sam = await seedTeammate('admin', 'Sam Cole')
    const ana = await seedTeammate('member', 'Ana Lima')
    const dataSync = await seedCustomRole('Data sync', [PERMISSIONS.POST_VIEW_PRIVATE])

    const personal = await createApiKey({ name: 'Inbox triage' }, ana)
    const owner = await createApiKey(
      { name: 'Order export', kind: 'workspace', roleId: await systemRoleId(SYSTEM_ROLES.OWNER) },
      ben,
      ADMIN_GRANTER
    )
    const manager = await createApiKey(
      { name: 'Reports', kind: 'workspace', roleId: await systemRoleId(SYSTEM_ROLES.MANAGER) },
      ben,
      ADMIN_GRANTER
    )
    const lead = await createApiKey(
      {
        name: 'Warehouse sync',
        kind: 'workspace',
        roleId: await systemRoleId(SYSTEM_ROLES.SUPPORT_LEAD),
      },
      ben,
      ADMIN_GRANTER
    )
    const crm = await createApiKey(
      { name: 'CRM sync', kind: 'workspace', roleId: dataSync },
      sam,
      ADMIN_GRANTER
    )
    const orphan = await createApiKey(
      { name: 'Orphan', kind: 'workspace', roleId: dataSync },
      sam,
      ADMIN_GRANTER
    )
    await testDb.update(apiKeys).set({ createdById: null }).where(eq(apiKeys.id, orphan.apiKey.id))
    await removeTeamMember(sam, ben, null, undefined, { granterRole: 'admin' })

    const byId = new Map((await listManagedApiKeys(ADMIN_GRANTER)).map((k) => [k.id, k]))

    expect(byId.get(personal.apiKey.id)).toMatchObject({
      kind: 'personal',
      creatorName: 'Ana Lima',
      creatorIsTeammate: true,
      role: null,
    })
    expect(byId.get(owner.apiKey.id)).toMatchObject({
      kind: 'workspace',
      creatorName: 'Ben Ortiz',
      role: { id: await systemRoleId(SYSTEM_ROLES.OWNER), name: 'Owner' },
    })
    expect(byId.get(manager.apiKey.id)?.role).toEqual({
      id: await systemRoleId(SYSTEM_ROLES.MANAGER),
      name: 'Manager',
    })
    expect(byId.get(lead.apiKey.id)?.role?.id).toBe(await systemRoleId(SYSTEM_ROLES.SUPPORT_LEAD))
    expect(byId.get(crm.apiKey.id)).toMatchObject({
      creatorName: 'Sam Cole',
      creatorIsTeammate: false,
      role: { id: dataSync, name: 'Data sync' },
    })
    expect(byId.get(orphan.apiKey.id)).toMatchObject({
      createdById: null,
      creatorName: null,
      creatorIsTeammate: false,
    })
  })

  it('leaves revoked keys out', async () => {
    const ben = await seedTeammate('admin')
    const { apiKey } = await createApiKey({ name: 'Old' }, ben)
    await revokeApiKey(apiKey.id)
    expect((await listManagedApiKeys(ADMIN_GRANTER)).some((k) => k.id === apiKey.id)).toBe(false)
  })
})

describe.skipIf(!fixture.available)('the workspace key role options', () => {
  it('marks Owner grantable only by an admin and flags admin-level roles', async () => {
    const memberGranter = { permissions: ALL_PERMISSIONS, role: 'member' as const }
    const byKey = (options: Awaited<ReturnType<typeof listWorkspaceKeyRoleOptions>>) =>
      new Map(options.map((o) => [o.key, o]))

    const asAdmin = byKey(await listWorkspaceKeyRoleOptions(ADMIN_GRANTER))
    expect(asAdmin.get(SYSTEM_ROLES.OWNER)).toMatchObject({ grantable: true, highImpact: true })
    expect(asAdmin.get(SYSTEM_ROLES.ADMIN)).toMatchObject({ grantable: true, highImpact: true })
    expect(asAdmin.get(SYSTEM_ROLES.MANAGER)).toMatchObject({ grantable: true, highImpact: false })

    const asMember = byKey(await listWorkspaceKeyRoleOptions(memberGranter))
    expect(asMember.get(SYSTEM_ROLES.OWNER)?.grantable).toBe(false)
    expect(asMember.get(SYSTEM_ROLES.ADMIN)?.grantable).toBe(true)
  })

  it('marks roles holding permissions the granter lacks as not grantable', async () => {
    const wide = await seedCustomRole('Wide', [PERMISSIONS.TICKET_VIEW_ALL])
    const narrow = await seedCustomRole('Narrow', [PERMISSIONS.POST_VIEW_PRIVATE])
    const granter = { permissions: [PERMISSIONS.POST_VIEW_PRIVATE], role: 'member' as const }

    const byId = new Map((await listWorkspaceKeyRoleOptions(granter)).map((o) => [o.id, o]))
    expect(byId.get(wide)).toMatchObject({ grantable: false, isSystem: false })
    expect(byId.get(narrow)).toMatchObject({ grantable: true, name: 'Narrow' })
    expect(byId.get(await systemRoleId(SYSTEM_ROLES.CONTRIBUTOR))?.grantable).toBe(false)
  })
})

describe.skipIf(!fixture.available)('managing a workspace key above your own role', () => {
  // A key manager without member.manage: below the Owner and Admin roles.
  const KEY_MANAGER = {
    permissions: [PERMISSIONS.API_KEY_MANAGE, PERMISSIONS.POST_VIEW_PRIVATE],
    role: 'member' as const,
  }

  async function ownerKey() {
    const admin = await seedTeammate('admin')
    const { apiKey } = await createApiKey(
      { name: 'Order export', kind: 'workspace', roleId: await systemRoleId(SYSTEM_ROLES.OWNER) },
      admin,
      ADMIN_GRANTER
    )
    return { admin, apiKey }
  }

  it('refuses to rotate, rename or re-role a key whose role the manager cannot grant', async () => {
    const { apiKey } = await ownerKey()
    const [before] = await testDb.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id))
    const manager = await seedTeammate('member')
    const narrow = await seedCustomRole('Narrow', [PERMISSIONS.POST_VIEW_PRIVATE])
    const scoped = { kind: 'workspace' as const, granter: KEY_MANAGER }

    await expect(rotateApiKey(apiKey.id, scoped)).rejects.toThrow(ForbiddenError)
    await expect(updateApiKeyName(apiKey.id, 'Mine', scoped)).rejects.toThrow(ForbiddenError)
    await expect(setWorkspaceKeyRole(apiKey.id, narrow, KEY_MANAGER, manager)).rejects.toThrow(
      ForbiddenError
    )
    const [row] = await testDb.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id))
    expect(row.name).toBe('Order export')
    expect(row.keyHash).toBe(before.keyHash)
  })

  it('lets an admin rotate, rename and re-role it', async () => {
    const { admin, apiKey } = await ownerKey()
    const narrow = await seedCustomRole('Narrow', [PERMISSIONS.POST_VIEW_PRIVATE])
    const scoped = { kind: 'workspace' as const, granter: ADMIN_GRANTER }

    await expect(rotateApiKey(apiKey.id, scoped)).resolves.toHaveProperty('plainTextKey')
    await expect(updateApiKeyName(apiKey.id, 'Renamed', scoped)).resolves.toMatchObject({
      name: 'Renamed',
    })
    await expect(
      setWorkspaceKeyRole(apiKey.id, narrow, ADMIN_GRANTER, admin)
    ).resolves.toMatchObject({ id: apiKey.id })
  })

  it('lets any key manager revoke it', async () => {
    const first = await ownerKey()
    const second = await ownerKey()
    await expect(revokeApiKey(first.apiKey.id)).resolves.toBeUndefined()
    await expect(revokeApiKey(second.apiKey.id)).resolves.toBeUndefined()
  })

  it('marks in the list which workspace keys the viewer can manage', async () => {
    const { apiKey } = await ownerKey()
    const admin = await seedTeammate('admin')
    const { apiKey: narrowKey } = await createApiKey(
      {
        name: 'Narrow',
        kind: 'workspace',
        roleId: await seedCustomRole('Narrow', [PERMISSIONS.POST_VIEW_PRIVATE]),
      },
      admin,
      ADMIN_GRANTER
    )

    const asManager = new Map((await listManagedApiKeys(KEY_MANAGER)).map((k) => [k.id, k]))
    expect(asManager.get(apiKey.id)?.manageable).toBe(false)
    expect(asManager.get(narrowKey.id)?.manageable).toBe(true)
    const asAdmin = new Map((await listManagedApiKeys(ADMIN_GRANTER)).map((k) => [k.id, k]))
    expect(asAdmin.get(apiKey.id)?.manageable).toBe(true)
  })
})

describe.skipIf(!fixture.available)('expired keys', () => {
  it('does not rotate an expired key', async () => {
    const me = await seedTeammate('member')
    const { apiKey } = await createApiKey(
      { name: 'Old', expiresAt: new Date(Date.now() - 60_000) },
      me
    )
    await expect(rotateApiKey(apiKey.id, { kind: 'personal', createdById: me })).rejects.toThrow(
      NotFoundError
    )
    await expect(
      revokeApiKey(apiKey.id, { kind: 'personal', createdById: me })
    ).resolves.toBeUndefined()
  })
})
