/**
 * Real-Postgres coverage for workspace API keys.
 *
 * A workspace key belongs to nobody. Its authority is its own workspace role,
 * granted under the same ceiling as re-roling a teammate, and nobody joining or
 * leaving the team changes it. Its creator is kept only as an audit record.
 * Keys come from createApiKey, people move through updateMemberRole and
 * removeTeamMember, and requests authenticate through withApiKeyAuth inside a
 * rolled-back transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  apiKeys,
  eq,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  user,
} from '@/lib/server/db'
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ROLES,
  type PermissionKey,
} from '@/lib/shared/permissions'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/lib/shared/errors'

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

vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 100 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

import { withApiKeyAuth } from '../auth'
import { serviceActorFromApiAuth } from '../service-actor'
import {
  createApiKey,
  revokeApiKey,
  setWorkspaceKeyRole,
} from '@/lib/server/domains/api-keys/api-key.service'
import {
  removeTeamMember,
  updateMemberRole,
} from '@/lib/server/domains/principals/principal.service'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: apiKeys.id, kind: apiKeys.kind }).from(apiKeys).limit(0)
    await db.select({ id: principalRoleAssignments.id }).from(principalRoleAssignments).limit(0)
    await db.select({ id: roles.id }).from(roles).where(eq(roles.key, SYSTEM_ROLES.SUPPORT_LEAD))
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(role: 'admin' | 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `Teammate ${role}`, email: `ws-key-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function systemRoleId(key: string): Promise<RoleId> {
  const [row] = await testDb.select({ id: roles.id }).from(roles).where(eq(roles.key, key))
  return row.id as RoleId
}

async function rolePermissionKeys(roleId: RoleId): Promise<Set<PermissionKey>> {
  const rows = await testDb
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId))
  return new Set(rows.map((r) => r.key as PermissionKey))
}

async function seedCustomRole(granted: PermissionKey[]): Promise<RoleId> {
  const roleId = createId('role') as RoleId
  await testDb.insert(roles).values({ id: roleId, key: roleId, name: 'Narrow', isSystem: false })
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

function bearer(token: string): Request {
  return new Request('https://example.com/api/v1/tickets', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
}

const ADMIN_GRANTER = { permissions: ALL_PERMISSIONS, role: 'admin' as const }

async function seedWorkspaceKey(roleKey: string = SYSTEM_ROLES.SUPPORT_LEAD) {
  const creator = await seedTeammate('admin')
  const manager = await seedTeammate('admin')
  const roleId = await systemRoleId(roleKey)
  const { apiKey, plainTextKey } = await createApiKey(
    { name: 'CRM sync', kind: 'workspace', roleId },
    creator,
    ADMIN_GRANTER
  )
  return { creator, manager, roleId, apiKey, token: plainTextKey }
}

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('workspace API keys (real Postgres)', () => {
  it('carries exactly its own role and no creator row scope', async () => {
    const { apiKey, roleId, token } = await seedWorkspaceKey()

    expect(apiKey.kind).toBe('workspace')
    const auth = await withApiKeyAuth(bearer(token))
    expect(auth.role).toBe('member')
    expect(new Set(auth.permissions)).toEqual(await rolePermissionKeys(roleId))
    expect(auth.scopePrincipalId).toBeUndefined()
    expect(serviceActorFromApiAuth(auth).scopePrincipalId).toBeUndefined()
  })

  it('keeps working after its creator leaves, while their personal key stops', async () => {
    const { creator, manager, token } = await seedWorkspaceKey()
    const personal = await createApiKey({ name: 'Laptop' }, creator)

    await removeTeamMember(creator, manager, null, undefined, { granterRole: 'admin' })

    await expect(withApiKeyAuth(bearer(personal.plainTextKey))).rejects.toThrow(UnauthorizedError)
    const auth = await withApiKeyAuth(bearer(token), { permission: PERMISSIONS.TICKET_VIEW })
    expect(auth.permissions.has(PERMISSIONS.TICKET_VIEW)).toBe(true)
  })

  it('does not follow its creator being demoted', async () => {
    const { creator, manager, roleId, token } = await seedWorkspaceKey()
    const narrow = await seedCustomRole([PERMISSIONS.POST_VIEW_PRIVATE])
    await updateMemberRole(creator, 'member', manager, null, undefined, {
      assignRoleId: narrow,
      granterPermissions: ALL_PERMISSIONS,
      granterRole: 'admin',
    })

    const auth = await withApiKeyAuth(bearer(token))
    expect(new Set(auth.permissions)).toEqual(await rolePermissionKeys(roleId))
  })

  it('gives the Owner role the full Owner authority', async () => {
    const { token } = await seedWorkspaceKey(SYSTEM_ROLES.OWNER)

    const auth = await withApiKeyAuth(bearer(token), { permission: PERMISSIONS.MEMBER_MANAGE })
    expect(auth.role).toBe('admin')
  })

  it('refuses a role with permissions the creator does not hold', async () => {
    const creator = await seedTeammate('member')
    const roleId = await systemRoleId(SYSTEM_ROLES.SUPPORT_LEAD)
    const held = [...(await permissionsForPrincipal(creator, 'member'))].filter(
      (key) => key !== PERMISSIONS.TICKET_VIEW_ALL
    )

    await expect(
      createApiKey({ name: 'Too wide', kind: 'workspace', roleId }, creator, {
        permissions: held,
        role: 'member',
      })
    ).rejects.toThrow(ForbiddenError)
  })

  it('lets only an admin grant the Owner role', async () => {
    const creator = await seedTeammate('member')
    const roleId = await systemRoleId(SYSTEM_ROLES.OWNER)

    await expect(
      createApiKey({ name: 'Owner key', kind: 'workspace', roleId }, creator, {
        permissions: ALL_PERMISSIONS,
        role: 'member',
      })
    ).rejects.toThrow('Only an admin can grant the Admin role')
  })

  it('refuses a workspace key without a role or without the creator authority', async () => {
    const creator = await seedTeammate('admin')
    const roleId = await systemRoleId(SYSTEM_ROLES.SUPPORT_LEAD)

    await expect(
      createApiKey({ name: 'No role', kind: 'workspace' }, creator, ADMIN_GRANTER)
    ).rejects.toThrow('A workspace key needs a role')
    await expect(
      createApiKey({ name: 'No granter', kind: 'workspace', roleId }, creator)
    ).rejects.toThrow(ForbiddenError)
  })

  it('takes a new role on the next request', async () => {
    const { apiKey, manager, token } = await seedWorkspaceKey()
    const narrow = await seedCustomRole([PERMISSIONS.POST_VIEW_PRIVATE])

    await setWorkspaceKeyRole(apiKey.id, narrow, ADMIN_GRANTER, manager)

    const auth = await withApiKeyAuth(bearer(token))
    expect([...auth.permissions]).toEqual([PERMISSIONS.POST_VIEW_PRIVATE])
  })

  it('does not give a personal key a role', async () => {
    const creator = await seedTeammate('admin')
    const { apiKey } = await createApiKey({ name: 'Personal' }, creator)
    const roleId = await systemRoleId(SYSTEM_ROLES.SUPPORT_LEAD)

    await expect(setWorkspaceKeyRole(apiKey.id, roleId, ADMIN_GRANTER, creator)).rejects.toThrow(
      NotFoundError
    )
  })

  it('refuses a role change on a revoked key and leaves its principal demoted', async () => {
    const { apiKey, manager } = await seedWorkspaceKey()
    await revokeApiKey(apiKey.id)
    const roleId = await systemRoleId(SYSTEM_ROLES.SUPPORT_LEAD)

    await expect(setWorkspaceKeyRole(apiKey.id, roleId, ADMIN_GRANTER, manager)).rejects.toThrow(
      NotFoundError
    )
    const [row] = await testDb
      .select({ role: principal.role })
      .from(principal)
      .where(eq(principal.id, apiKey.principalId))
    expect(row.role).toBe('user')
  })

  it('stops working once revoked', async () => {
    const { apiKey, token } = await seedWorkspaceKey()

    await revokeApiKey(apiKey.id)

    await expect(withApiKeyAuth(bearer(token))).rejects.toThrow(UnauthorizedError)
  })
})
