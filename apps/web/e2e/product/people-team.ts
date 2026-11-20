/**
 * Helpers for the team-access and portal-account specs
 * (e2e/tests/people/{members,invitations,roles,team-access,portal-account,unsubscribe}.spec.ts):
 * team invitations, role assignments, REST keys and portal users with their
 * own sessions.
 *
 *   const admin = await personApi(playwright, 'admin')
 *   const res = await mustCall(admin, 'addTeamMembersFn', { principalIds: [], emails: [email], role: 'member' })
 *   const invite = await invitationFor(email)
 *
 * Every row a test makes carries its marker; tests never touch the six
 * seeded people's roles, sessions or preferences.
 */
import { randomBytes } from 'node:crypto'
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { supportDb } from '../support/db'
import { supportEnv } from '../support/env'
import { apiFor, createKey } from '../support/api-client'
import { callServerFn, type ServerFnResult } from '../support/server-fns'
import { mintCustomer, portalContext, type MintedCustomer } from '../support/widget-portal'

export { personApi, callServerFn } from '../support/server-fns'

export function suffix(): string {
  return randomBytes(3).toString('hex')
}

export function uuid(typeId: string): string {
  return toUuid(typeId as `principal_${string}`)
}

/** Call a server function and fail the test when it throws. */
export async function mustCall<T = unknown>(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { sourceFile?: string; method?: 'POST' | 'GET' } = {}
): Promise<T> {
  const res = await callServerFn<T>(api, name, data, opts)
  expect(res.ok, `${name}: ${res.raw.slice(0, 400)}`).toBe(true)
  return res.data
}

/** Call a server function expecting it to throw; returns the result. */
export async function refusedCall(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { sourceFile?: string; method?: 'POST' | 'GET' } = {}
): Promise<ServerFnResult> {
  const res = await callServerFn(api, name, data, opts)
  expect(res.ok, `${name} should be refused: ${res.raw.slice(0, 300)}`).toBe(false)
  return res
}

// ---------------------------------------------------------------------------
// Portal users
// ---------------------------------------------------------------------------

export interface PortalUser extends MintedCustomer {
  context: BrowserContext
  api: APIRequestContext
}

/** A fresh identified portal user with a live session (portal cookie). */
export async function portalUser(
  browser: Browser,
  marker: string,
  opts: { name?: string; email?: string } = {}
): Promise<PortalUser> {
  const s = suffix()
  const customer = await mintCustomer({
    email: opts.email ?? `${marker}-${s}@customers.example`,
    name: opts.name ?? `Person ${marker} ${s}`,
  })
  const context = await portalContext(browser, customer)
  return { ...customer, context, api: context.request }
}

/** A portal user row with no session. */
export async function portalUserRow(marker: string): Promise<MintedCustomer> {
  const s = suffix()
  return mintCustomer({
    email: `${marker}-${s}@customers.example`,
    name: `Person ${marker} ${s}`,
  })
}

// ---------------------------------------------------------------------------
// Team invitations and roles
// ---------------------------------------------------------------------------

export interface InvitationRow {
  id: string
  typeId: string
  email: string
  role: string | null
  role_id: string | null
  status: string
  expires_at: Date
  last_sent_at: Date | null
  magic_link_tokens: string[]
}

/** The newest team invitation to `email`, or null. */
export async function invitationFor(email: string): Promise<InvitationRow | null> {
  const [row] = await supportDb()`
    SELECT id, email, role, role_id, status, expires_at, last_sent_at, magic_link_tokens
    FROM invitation WHERE lower(email) = lower(${email}) AND kind = 'team'
    ORDER BY created_at DESC LIMIT 1`
  if (!row) return null
  return { ...(row as unknown as InvitationRow), typeId: fromUuid('invite', row.id as string) }
}

/** Invite `email` to the team as the caller (addTeamMembersFn). */
export async function inviteByEmail(
  api: APIRequestContext,
  email: string,
  opts: { role?: 'admin' | 'member'; roleId?: string } = {}
): Promise<InvitationRow> {
  const res = await mustCall<{ ok: boolean; code?: string; message?: string }>(
    api,
    'addTeamMembersFn',
    { principalIds: [], emails: [email], role: opts.role ?? 'member', roleId: opts.roleId }
  )
  expect(res.ok, JSON.stringify(res)).toBe(true)
  const row = await invitationFor(email)
  if (!row) throw new Error(`no invitation row for ${email}`)
  return row
}

/** The id of a role by key. */
export async function roleIdOf(key: string): Promise<string> {
  const [row] = await supportDb()`SELECT id FROM roles WHERE key = ${key} LIMIT 1`
  if (!row) throw new Error(`no role ${key}`)
  return fromUuid('role', row.id as string)
}

/** A principal's legacy role and its workspace role assignment key (or null). */
export async function roleOf(
  principalId: string
): Promise<{ role: string | null; assigned: string | null }> {
  const sql = supportDb()
  const [p] = await sql`SELECT role FROM principal WHERE id = ${uuid(principalId)}`
  const [a] = await sql`SELECT r.key FROM principal_role_assignments pra
                        JOIN roles r ON r.id = pra.role_id
                        WHERE pra.principal_id = ${uuid(principalId)} LIMIT 1`
  return { role: (p?.role as string) ?? null, assigned: (a?.key as string) ?? null }
}

/** A principal row by user email, or null. */
export async function principalByEmail(
  email: string
): Promise<{ id: string; role: string; principalId: string } | null> {
  const [row] = await supportDb()`
    SELECT p.id, p.role FROM principal p JOIN "user" u ON u.id = p.user_id
    WHERE lower(u.email) = lower(${email}) LIMIT 1`
  if (!row) return null
  return {
    id: row.id as string,
    role: row.role as string,
    principalId: fromUuid('principal', row.id as string),
  }
}

/** A role holding exactly `permissions`, made through the database. Returns { key, id }. */
export async function customRole(
  marker: string,
  permissions: readonly string[]
): Promise<{ key: string; id: string; name: string }> {
  const sql = supportDb()
  const key = `e2e_${randomBytes(5).toString('hex')}`
  const name = `Role ${marker} ${suffix()}`.slice(0, 60)
  const roleUuid = toUuid(generateId('role'))
  const perms = await sql`SELECT id, key FROM permissions WHERE key IN ${sql([...permissions])}`
  if (perms.length !== permissions.length) {
    throw new Error(`Unknown permission keys in ${permissions.join(', ')}`)
  }
  await sql.begin(async (tx) => {
    await tx`INSERT INTO roles (id, key, name, description, is_system)
             VALUES (${roleUuid}, ${key}, ${name}, 'people e2e role', false)`
    for (const perm of perms) {
      await tx`INSERT INTO role_permissions (id, role_id, permission_id)
               VALUES (${toUuid(generateId('role_perm'))}, ${roleUuid}, ${perm.id as string})`
    }
  })
  return { key, id: fromUuid('role', roleUuid), name }
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

/** A REST client with a workspace key holding `roleKey` (default admin). */
export async function restWorkspace(
  playwright: PlaywrightWorkerArgs['playwright'],
  roleKey = 'admin'
): Promise<APIRequestContext> {
  const { key } = createKey({
    creatorEmail: 'e2e-support-admin@example.com',
    kind: 'workspace',
    roleKey,
  })
  return apiFor(playwright, supportEnv().baseUrl, key)
}

/** A REST client with a personal key created by `creatorEmail`. */
export async function restPersonal(
  playwright: PlaywrightWorkerArgs['playwright'],
  creatorEmail: string
): Promise<{ api: APIRequestContext; keyId: string; key: string }> {
  const created = createKey({ creatorEmail, kind: 'personal' })
  return {
    api: await apiFor(playwright, supportEnv().baseUrl, created.key),
    keyId: created.id,
    key: created.key,
  }
}
