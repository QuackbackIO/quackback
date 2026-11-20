/**
 * Real-Postgres coverage for MCP tools checking each tool's declared
 * permissions against the caller's current resolved set: for an API key, the
 * key's role preset intersected with its creator's current permissions; for
 * an OAuth caller, their own assignment-derived permissions. A teammate on a
 * custom role lacking a permission cannot reach a tool that needs it, even
 * with a scope that covers the tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { createId, generateId, type PrincipalId, type RoleId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, permissions, principal, rolePermissions, roles, user } from '@/lib/server/db'
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

const oauth = vi.hoisted(() => ({ payload: null as Record<string, unknown> | null }))
vi.mock('better-auth/oauth2', () => ({
  requestToResourceInput: () => ({}),
  verifyAccessTokenRequest: vi.fn(async () => {
    if (!oauth.payload) throw new Error('no token')
    return oauth.payload
  }),
}))

import { resolveAuthContext } from '../handler'
import { registerPostTools } from '../tools/posts'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import { updateMemberRole } from '@/lib/server/domains/principals/principal.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: rolePermissions.roleId }).from(rolePermissions).limit(0)
    await db.select({ id: principal.id, blocked: principal.blockedAt }).from(principal).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(role: 'admin' | 'member') {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `Teammate ${role}`, email: `mcp-perm-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return { userId, principalId }
}

/** A creator on a custom role holding exactly `granted`, and a feedback key they made. */
async function seedNarrowCreator(granted: PermissionKey[]) {
  const creator = await seedTeammate('admin')
  const manager = await seedTeammate('admin')
  const { plainTextKey } = await createApiKey(
    { name: 'Triage bot', scopes: ['read:feedback', 'write:feedback'] },
    creator.principalId
  )
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
  await updateMemberRole(creator.principalId, 'member', manager.principalId, null, undefined, {
    assignRoleId: roleId,
    granterPermissions: ALL_PERMISSIONS,
    granterRole: 'admin',
  })
  return { creator, token: plainTextKey }
}

function bearer(token: string): Request {
  return new Request('https://example.com/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
}

async function authFor(token: string): Promise<McpAuthContext> {
  const auth = await resolveAuthContext(bearer(token))
  if (auth instanceof Response) throw new Error(`Expected an auth context, got ${auth.status}`)
  return auth
}

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function postTools(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const server = {
    registerTool: (name: string, _c: unknown, handler: Handler) => void handlers.set(name, handler),
  }
  registerPostTools(server as never, auth)
  return handlers
}

function text(result: CallToolResult): string {
  return result.content.map((part) => ('text' in part ? part.text : '')).join('\n')
}

const PERMISSION_DENIED = /requires the '([a-z_.]+)' permission/

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => {
    oauth.payload = null
    return fixture.rollback()
  })
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('MCP tool permissions (real Postgres)', () => {
  it('refuses triage_post when the key creator role lacks post.set_status', async () => {
    const { token } = await seedNarrowCreator([PERMISSIONS.POST_VIEW_PRIVATE])
    const tools = postTools(await authFor(token))

    const triage = await tools.get('triage_post')!({
      postId: generateId('post'),
      statusId: generateId('post_status'),
    })
    expect(triage.isError).toBe(true)
    expect(text(triage)).toMatch(PERMISSION_DENIED)
    expect(text(triage)).toContain("'post.set_status'")

    // A read tool the role does cover passes the guard and runs.
    const activity = await tools.get('get_post_activity')!({ postId: generateId('post') })
    expect(text(activity)).not.toMatch(PERMISSION_DENIED)
  })

  it('refuses a read tool the creator role lacks while the covered write passes the guard', async () => {
    const { token } = await seedNarrowCreator([PERMISSIONS.POST_SET_STATUS])
    const tools = postTools(await authFor(token))

    const activity = await tools.get('get_post_activity')!({ postId: generateId('post') })
    expect(activity.isError).toBe(true)
    expect(text(activity)).toContain("'post.view_private'")

    // The guard passes; the handler then fails on the unknown post.
    const triage = await tools.get('triage_post')!({
      postId: generateId('post'),
      statusId: generateId('post_status'),
    })
    expect(text(triage)).not.toMatch(PERMISSION_DENIED)
  })

  it('gates an OAuth caller on their own current permissions the same way', async () => {
    const { creator } = await seedNarrowCreator([PERMISSIONS.POST_VIEW_PRIVATE])
    oauth.payload = {
      sub: creator.userId,
      principalId: creator.principalId,
      scope: 'read:feedback write:feedback',
      name: 'Teammate',
    }

    const auth = await authFor('oauth_access_token')
    expect(auth.authMethod).toBe('oauth')
    expect([...(auth.permissions ?? [])]).toEqual([PERMISSIONS.POST_VIEW_PRIVATE])

    const triage = await postTools(auth).get('triage_post')!({
      postId: generateId('post'),
      ownerPrincipalId: 'me',
    })
    expect(triage.isError).toBe(true)
    expect(text(triage)).toContain("'post.set_owner'")
  })
})
