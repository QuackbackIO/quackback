/**
 * Real-Postgres coverage for the MCP endpoint applying the same API-key rule
 * as the REST API: a key acts for its creator, so its authority is the key's
 * role preset intersected with the creator's current permissions, and a key
 * whose creator has left the team is refused like an unknown key. Covers the
 * request-level auth context and the settings actor resolved per tool call.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { apiKeys, eq, permissions, principal, rolePermissions, roles, user } from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { McpAuthContext } from '../types'

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

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://example.com' },
  getBaseUrl: () => 'https://example.com',
}))

import { resolveAuthContext } from '../handler'
import { resolveMcpActor } from '../resolve-actor'
import { mcpAgentActor, mcpMemberActor } from '../tools/helpers'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import {
  removeTeamMember,
  updateMemberRole,
} from '@/lib/server/domains/principals/principal.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: apiKeys.id, creator: apiKeys.createdById }).from(apiKeys).limit(0)
    await db.select({ id: principal.id, blocked: principal.blockedAt }).from(principal).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(role: 'admin' | 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `Teammate ${role}`, email: `mcp-key-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
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

function mcpRequest(token: string): Request {
  return new Request('https://example.com/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
}

async function seedAdminKey() {
  const creator = await seedTeammate('admin')
  const manager = await seedTeammate('admin')
  const { plainTextKey } = await createApiKey({ name: 'MCP client' }, creator)
  return { creator, manager, token: plainTextKey }
}

async function authFor(token: string): Promise<McpAuthContext> {
  const auth = await resolveAuthContext(mcpRequest(token))
  if (auth instanceof Response) throw new Error(`Expected an auth context, got ${auth.status}`)
  return auth
}

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)(
  'MCP API-key bearer follows its creator (real Postgres)',
  () => {
    it('carries the admin creator authority on the request and the settings actor', async () => {
      const { creator, token } = await seedAdminKey()

      const auth = await authFor(token)
      expect(auth.authMethod).toBe('api-key')
      expect(auth.role).toBe('admin')
      expect(auth.permissions?.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(true)

      const actor = await resolveMcpActor(auth, 'read:settings')
      expect(actor.principalId).toBe(creator)
      expect(actor.permissions?.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(true)
    })

    it('drops to the member role and its permissions once the creator is demoted', async () => {
      const { creator, manager, token } = await seedAdminKey()
      await updateMemberRole(creator, 'member', manager, null, undefined, { granterRole: 'admin' })

      const auth = await authFor(token)
      expect(auth.role).toBe('member')
      expect(auth.permissions?.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
      expect(auth.permissions?.has(PERMISSIONS.POST_CREATE)).toBe(true)
      expect(mcpAgentActor(auth).permissions?.has(PERMISSIONS.MEMBER_MANAGE)).toBe(false)

      const actor = await resolveMcpActor(auth, 'read:settings')
      expect(actor.role).toBe('member')
      expect(actor.permissions?.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
    })

    it('carries the creator as the row scope of every support-tool actor', async () => {
      const { creator, token } = await seedAdminKey()

      const auth = await authFor(token)
      expect(auth.scopePrincipalId).toBe(creator)
      expect(mcpAgentActor(auth)).toMatchObject({
        principalType: 'service',
        scopePrincipalId: creator,
      })
      expect(await mcpMemberActor(auth)).toMatchObject({ scopePrincipalId: creator })
    })

    it('answers 401 like an unknown key once the creator is removed from the team', async () => {
      const { creator, manager, token } = await seedAdminKey()
      await removeTeamMember(creator, manager, null, undefined, { granterRole: 'admin' })

      const result = await resolveAuthContext(mcpRequest(token))
      expect(result).toBeInstanceOf(Response)
      const response = result as Response
      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toContain('resource_metadata=')
    })

    it('answers 401 for a key with no recorded creator and refuses it on the settings path', async () => {
      const { token } = await seedAdminKey()
      const auth = await authFor(token)
      // Deleting the creator's principal clears created_by_id (ON DELETE SET NULL).
      await testDb
        .update(apiKeys)
        .set({ createdById: null })
        .where(eq(apiKeys.principalId, auth.principalId))

      const result = await resolveAuthContext(mcpRequest(token))
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
      await expect(resolveMcpActor(auth, 'read:settings')).rejects.toThrow(
        'A current workspace owner must review this request.'
      )
    })

    it('refuses a permission missing from the creator custom role on every MCP path', async () => {
      const { creator, manager, token } = await seedAdminKey()
      const narrow = await seedCustomRole([PERMISSIONS.POST_VIEW_PRIVATE])
      await updateMemberRole(creator, 'member', manager, null, undefined, {
        assignRoleId: narrow,
        granterPermissions: ALL_PERMISSIONS,
        granterRole: 'admin',
      })

      const auth = await authFor(token)
      expect([...(auth.permissions ?? [])]).toEqual([PERMISSIONS.POST_VIEW_PRIVATE])
      const member = await mcpMemberActor(auth)
      expect(member.permissions?.has(PERMISSIONS.POST_CREATE)).toBe(false)
      expect(member.permissions?.has(PERMISSIONS.POST_VIEW_PRIVATE)).toBe(true)

      const actor = await resolveMcpActor(auth)
      expect([...(actor.permissions ?? [])]).toEqual([PERMISSIONS.POST_VIEW_PRIVATE])
    })
  }
)
