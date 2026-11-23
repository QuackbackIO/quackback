/**
 * Helpers for the REST people and key specs (tests/platform/rest-people.spec.ts,
 * keys.spec.ts, keys-ui.spec.ts).
 *
 *   const admin = await keyApi(playwright, baseURL, { creatorEmail, kind: 'workspace' })
 *   const user = await identify(admin.api, `${marker}@customers.example`)
 *   const board = await makeBoard(admin.api, marker)
 *
 * Keys are made through the app's own service (support/api-client.ts) and each
 * request context carries its own client address, so the per-address rate
 * limit never couples tests.
 */
import { expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { apiFor, createKey, expectJson, type KeyOptions, type Wire } from '../support/api-client'
import { supportDb } from '../support/db'
import { supportEnv } from '../support/env'
import { mintSession } from '../support/teammates'

export const UNAUTHORIZED_MESSAGE =
  'Invalid or missing API key. Provide a valid key in the Authorization header: Bearer qb_xxx'

/** The headers every v1 JSON answer carries. */
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cache-control': 'no-store, private',
}

export interface KeyApi {
  api: APIRequestContext
  key: string
  id: string
  principalId: string
}

/** A key made through the service, and a request context that uses it. */
export async function keyApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  opts: KeyOptions,
  extraHeaders: Record<string, string> = {}
): Promise<KeyApi> {
  const created = createKey(opts)
  const api = await apiFor(playwright, baseURL, created.key, extraHeaders)
  return { api, ...created }
}

/** POST /users/identify; returns the answer's data. */
export async function identify(
  api: APIRequestContext,
  email: string,
  extra: Record<string, unknown> = {},
  status = 201
): Promise<Wire> {
  const body = await expectJson(
    await api.post('/api/v1/users/identify', { data: { email, ...extra } }),
    status
  )
  return body.data
}

/** A public board only this test uses; returns its TypeID. */
export async function makeBoard(api: APIRequestContext, marker: string): Promise<string> {
  const body = await expectJson(
    await api.post('/api/v1/boards', { data: { name: `Board ${marker}`.slice(0, 100) } }),
    201
  )
  return body.data.id as string
}

/** Make a board team-only (no REST route changes board access). */
export async function makeBoardTeamOnly(boardId: string): Promise<void> {
  await supportDb()`UPDATE boards SET access = jsonb_set(access, '{view}', '"team"')
                    WHERE id = ${toUuid(boardId as `board_${string}`)}`
}

/** POST /posts on a board; returns the post's TypeID. */
export async function makePost(
  api: APIRequestContext,
  boardId: string,
  title: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const body = await expectJson(
    await api.post('/api/v1/posts', { data: { boardId, title, ...extra } }),
    201
  )
  return body.data.id as string
}

/** A manual segment only this test uses, straight in the database. */
export async function seedSegment(
  marker: string
): Promise<{ id: string; uuid: string; slug: string }> {
  const typeId = generateId('segment')
  const uuid = toUuid(typeId)
  const slug = `seg-${marker}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  await supportDb()`INSERT INTO segments (id, name, type, slug)
                    VALUES (${uuid}, ${`Segment ${marker}`}, 'manual', ${slug})`
  return { id: typeId, uuid, slug }
}

/** user_segments rows of a segment, by principal uuid. */
export async function segmentRows(segmentUuid: string): Promise<Map<string, string>> {
  const rows = await supportDb()`SELECT principal_id, added_by FROM user_segments
                                 WHERE segment_id = ${segmentUuid}`
  return new Map(rows.map((r) => [r.principal_id as string, r.added_by as string]))
}

/** audit_log rows of one event type for a target id, oldest first. */
export async function auditRows(eventType: string, targetId: string): Promise<Wire[]> {
  return supportDb()`SELECT event_type, event_outcome, actor_type, actor_role, auth_method,
                            target_type, target_id, before_value, after_value, metadata,
                            channel, credential_kind, credential_id
                     FROM audit_log WHERE event_type = ${eventType} AND target_id = ${targetId}
                     ORDER BY occurred_at` as unknown as Promise<Wire[]>
}

/** A request context signed in as a user (TypeID), for server functions and session routes. */
export async function sessionApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  userId: string
): Promise<APIRequestContext> {
  const storageState = await mintSession(userId)
  return playwright.request.newContext({
    baseURL: supportEnv().baseUrl,
    storageState,
    extraHTTPHeaders: { connection: 'close' },
  })
}

/** The api_keys row of a key (TypeID). */
export async function keyRow(keyId: string): Promise<Wire> {
  const [row] = await supportDb()`SELECT k.name, k.kind, k.scopes, k.expires_at, k.last_used_at,
                                         k.revoked_at, k.key_prefix, k.created_by_id,
                                         p.role AS principal_role, p.display_name
                                  FROM api_keys k JOIN principal p ON p.id = k.principal_id
                                  WHERE k.id = ${toUuid(keyId as `api_key_${string}`)}`
  return row ?? null
}

/** Expect a v1 403 with this exact message. */
export async function expectForbidden(
  res: Awaited<ReturnType<APIRequestContext['get']>>,
  message: string
): Promise<void> {
  const body = await expectJson(res, 403)
  expect(body.error).toEqual({ code: 'FORBIDDEN', message })
}

/** The roles.key support-api-fixtures.ts gives a custom role made by newTeammate(name). */
export function customRoleKey(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `e2e_${slug.replace(/-/g, '_')}`
}

/** A role's TypeID by its key. */
export async function roleIdOf(key: string): Promise<string> {
  const [row] = await supportDb()`SELECT id FROM roles WHERE key = ${key}`
  if (!row) throw new Error(`No role ${key}`)
  return fromUuid('role', row.id as string)
}

/** principal.role of a principal (TypeID), or null when the row is gone. */
export async function principalRole(principalId: string): Promise<string | null> {
  const [row] = await supportDb()`SELECT role FROM principal
                                  WHERE id = ${toUuid(principalId as `principal_${string}`)}`
  return (row?.role as string | undefined) ?? null
}
