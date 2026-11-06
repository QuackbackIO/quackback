/**
 * The self-service key functions, on real Postgres: any teammate manages their
 * own personal keys and nothing else, while the workspace allows new ones.
 * Someone else's key and every workspace key read as not found. Admins revoke
 * any key but cannot rotate or rename someone else's personal key.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { apiKeys, eq, principal, roles, user } from '@/lib/server/db'
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  personalApiKeysEnabled: true,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.requireAuth(...args),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getDeveloperConfig: async () => ({
    mcpEnabled: true,
    mcpPortalAccessEnabled: false,
    oauthDynamicClientRegistrationEnabled: true,
    personalApiKeysEnabled: hoisted.personalApiKeysEnabled,
  }),
  updateDeveloperConfig: vi.fn(async (input: { personalApiKeysEnabled?: boolean }) => {
    if (input.personalApiKeysEnabled !== undefined)
      hoisted.personalApiKeysEnabled = input.personalApiKeysEnabled
  }),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))
vi.mock('@/lib/server/domains/teams', () => ({ addPrincipalToDefaultTeam: vi.fn() }))
vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: vi.fn(async () => {}),
}))

const { fetchMyApiKeysFn, createMyApiKeyFn, renameMyApiKeyFn, rotateMyApiKeyFn, revokeMyApiKeyFn } =
  await import('../personal-api-keys')
const {
  createApiKeyFn,
  fetchApiKeys,
  revokeApiKeyFn,
  rotateApiKeyFn,
  updateApiKeyFn,
  setWorkspaceKeyRoleFn,
} = await import('../api-keys')
const { setPersonalKeyPolicyFn } = await import('../personal-key-policy')
const { createApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: apiKeys.id, kind: apiKeys.kind }).from(apiKeys).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(role: 'admin' | 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `Person ${role}`, email: `self-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

function signInAs(
  principalId: PrincipalId,
  role: 'admin' | 'member' | 'user',
  perms = ALL_PERMISSIONS
) {
  hoisted.requireAuth.mockImplementation(async (options?: { permission?: string }) => {
    const permissions = role === 'user' ? [] : [...perms]
    if (options?.permission && !permissions.includes(options.permission as never))
      throw new Error(`Access denied: Requires permission '${options.permission}'`)
    return {
      user: { id: 'user_x', name: 'X', email: 'x@example.com', image: null },
      principal: { id: principalId, role, type: 'user' },
      settings: { id: 'workspace_x', slug: 'x', name: 'X', logoKey: null },
      permissions,
      scope: role === 'user' ? 'portal' : 'dashboard',
    }
  })
}

async function managerRoleId(): Promise<RoleId> {
  const [row] = await testDb
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, SYSTEM_ROLES.MANAGER))
  return row.id as RoleId
}

if (fixture.available) {
  beforeEach(() => {
    hoisted.personalApiKeysEnabled = true
    return fixture.begin()
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('self-service personal keys', () => {
  it('creates a personal key for any teammate, whatever their permissions', async () => {
    const me = await seedPerson('member')
    signInAs(me, 'member', [])

    const before = Date.now()
    const result = await createMyApiKeyFn({
      data: { name: 'Laptop', scopes: ['read:feedback'], expiry: '90d' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.apiKey.kind).toBe('personal')
    expect(result.apiKey.createdById).toBe(me)
    const days = (result.apiKey.expiresAt!.getTime() - before) / 86_400_000
    expect(Math.round(days)).toBe(90)

    const list = await fetchMyApiKeysFn()
    expect(list.canCreate).toBe(true)
    expect(list.keys.map((k) => k.id)).toEqual([result.apiKey.id])
  })

  it('stores no expiry for "No expiry"', async () => {
    const me = await seedPerson('member')
    signInAs(me, 'member')
    const result = await createMyApiKeyFn({
      data: { name: 'CI', scopes: ['read:feedback'], expiry: 'never' },
    })
    expect(result.ok && result.apiKey.expiresAt).toBeNull()
  })

  it('refuses new keys while the policy is off, and keeps existing ones', async () => {
    const me = await seedPerson('member')
    signInAs(me, 'member')
    const existing = await createApiKey({ name: 'Old' }, me)
    hoisted.personalApiKeysEnabled = false

    expect(
      await createMyApiKeyFn({ data: { name: 'New', scopes: ['read:feedback'], expiry: '30d' } })
    ).toMatchObject({ ok: false, code: 'POLICY_OFF' })
    const list = await fetchMyApiKeysFn()
    expect(list.canCreate).toBe(false)
    expect(list.keys.map((k) => k.id)).toEqual([existing.apiKey.id])
    expect(await rotateMyApiKeyFn({ data: { id: existing.apiKey.id } })).toMatchObject({ ok: true })
  })

  it('refuses a signed-in person who is not on the team', async () => {
    const visitor = await seedPerson('user')
    signInAs(visitor, 'user')

    await expect(fetchMyApiKeysFn()).rejects.toThrow(/team member/)
    await expect(
      createMyApiKeyFn({ data: { name: 'Nope', scopes: ['read:feedback'], expiry: '30d' } })
    ).rejects.toThrow(/team member/)
    expect(await testDb.select().from(apiKeys).where(eq(apiKeys.createdById, visitor))).toEqual([])
  })

  it('manages my own personal key', async () => {
    const me = await seedPerson('member')
    signInAs(me, 'member')
    const { apiKey } = await createApiKey({ name: 'Mine' }, me)

    expect(await renameMyApiKeyFn({ data: { id: apiKey.id, name: 'Renamed' } })).toMatchObject({
      ok: true,
      apiKey: { name: 'Renamed' },
    })
    const rotated = await rotateMyApiKeyFn({ data: { id: apiKey.id } })
    expect(rotated.ok && rotated.plainTextKey).toMatch(/^qb_/)
    expect(await revokeMyApiKeyFn({ data: { id: apiKey.id } })).toEqual({ ok: true, id: apiKey.id })
  })

  it("treats someone else's key and any workspace key as not found", async () => {
    const me = await seedPerson('admin')
    const other = await seedPerson('member')
    signInAs(me, 'admin')
    const theirs = await createApiKey({ name: 'Theirs' }, other)
    const workspace = await createApiKey(
      { name: 'Mine but workspace', kind: 'workspace', roleId: await managerRoleId() },
      me,
      { permissions: ALL_PERMISSIONS, role: 'admin' }
    )

    for (const id of [theirs.apiKey.id, workspace.apiKey.id]) {
      expect(await renameMyApiKeyFn({ data: { id, name: 'X' } })).toMatchObject({
        ok: false,
        code: 'NOT_FOUND',
      })
      expect(await rotateMyApiKeyFn({ data: { id } })).toMatchObject({
        ok: false,
        code: 'NOT_FOUND',
      })
      expect(await revokeMyApiKeyFn({ data: { id } })).toMatchObject({
        ok: false,
        code: 'NOT_FOUND',
      })
    }
    const [row] = await testDb.select().from(apiKeys).where(eq(apiKeys.id, theirs.apiKey.id))
    expect(row.revokedAt).toBeNull()
    expect(row.name).toBe('Theirs')
  })
})

describe.skipIf(!fixture.available)('key manager functions', () => {
  it('creates only workspace keys, with the chosen role', async () => {
    const admin = await seedPerson('admin')
    signInAs(admin, 'admin')

    const result = await createApiKeyFn({
      data: { name: 'Sync', scopes: ['read:feedback'], roleId: await managerRoleId() },
    })
    expect(result).toMatchObject({ ok: true, apiKey: { kind: 'workspace' } })
  })

  it('returns the grant ceiling as a refusal', async () => {
    const lead = await seedPerson('member')
    signInAs(lead, 'member', ['api_key.manage'] as never)

    expect(
      await createApiKeyFn({
        data: { name: 'Too wide', scopes: ['read:feedback'], roleId: await managerRoleId() },
      })
    ).toMatchObject({ ok: false, code: 'GRANT_CEILING' })
  })

  it("revokes a teammate's personal key but does not rotate or rename it", async () => {
    const admin = await seedPerson('admin')
    const teammate = await seedPerson('member')
    signInAs(admin, 'admin')
    const { apiKey } = await createApiKey({ name: 'Teammate key' }, teammate)

    expect(await rotateApiKeyFn({ data: { id: apiKey.id } })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
    expect(await updateApiKeyFn({ data: { id: apiKey.id, name: 'Mine now' } })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
    expect(await revokeApiKeyFn({ data: { id: apiKey.id } })).toEqual({ ok: true, id: apiKey.id })
  })

  it("refuses to rotate, rename or re-role a key above the manager's role, but revokes it", async () => {
    const admin = await seedPerson('admin')
    const manager = await seedPerson('member')
    const [owner] = await testDb
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, SYSTEM_ROLES.OWNER))
    const { apiKey } = await createApiKey(
      { name: 'Order export', kind: 'workspace', roleId: owner.id as RoleId },
      admin,
      { permissions: ALL_PERMISSIONS, role: 'admin' }
    )
    signInAs(manager, 'member', ['api_key.manage'] as never)

    expect(await rotateApiKeyFn({ data: { id: apiKey.id } })).toMatchObject({
      ok: false,
      code: 'GRANT_CEILING',
    })
    expect(await updateApiKeyFn({ data: { id: apiKey.id, name: 'Mine' } })).toMatchObject({
      ok: false,
      code: 'GRANT_CEILING',
    })
    expect(
      await setWorkspaceKeyRoleFn({ data: { id: apiKey.id, roleId: await managerRoleId() } })
    ).toMatchObject({ ok: false, code: 'GRANT_CEILING' })
    const { keys } = await fetchApiKeys()
    expect(keys.find((k) => k.id === apiKey.id)?.manageable).toBe(false)
    expect(await revokeApiKeyFn({ data: { id: apiKey.id } })).toEqual({ ok: true, id: apiKey.id })
  })

  it('lists keys with their creator and switches the policy', async () => {
    const admin = await seedPerson('admin')
    const teammate = await seedPerson('member')
    signInAs(admin, 'admin')
    const { apiKey } = await createApiKey({ name: 'Teammate key' }, teammate)

    const { keys, personalKeysEnabled } = await fetchApiKeys()
    expect(personalKeysEnabled).toBe(true)
    expect(keys.find((k) => k.id === apiKey.id)).toMatchObject({
      kind: 'personal',
      creatorName: 'Person member',
      creatorIsTeammate: true,
    })

    expect(await setPersonalKeyPolicyFn({ data: { enabled: false } })).toEqual({ enabled: false })
    expect(hoisted.personalApiKeysEnabled).toBe(false)
  })

  it('keeps the policy switch to key managers', async () => {
    const member = await seedPerson('member')
    signInAs(member, 'member', [])
    await expect(setPersonalKeyPolicyFn({ data: { enabled: false } })).rejects.toThrow(
      /api_key.manage/
    )
  })
})
