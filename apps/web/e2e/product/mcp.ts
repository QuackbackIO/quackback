/**
 * Helpers for the product suite's MCP specs (tests/platform/mcp-*.spec.ts).
 *
 *   const admin = await adminApi(playwright, baseURL, people)  // REST + MCP as a workspace admin key
 *   const board = await newBoard(admin, marker)
 *   const post = await newPost(admin, board.id, `${marker} post`)
 *   const res = await mcpCall(admin, 'triage_post', { postId: post.id, statusId })
 *
 * Seeding goes through REST (or SQL for what REST cannot set, such as board
 * access tiers); the action under test goes through /api/mcp.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  expect,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { pollFor, supportDb } from '../support/db'
import {
  apiFor,
  createKey,
  expectJson,
  mcpOAuthToken,
  mcpRpc,
  type KeyOptions,
  type Wire,
} from '../support/api-client'
import type { SeededPeople } from '../support/people'

export type Api = APIRequestContext
type Playwright = PlaywrightWorkerArgs['playwright']

/** Every capability scope, in vocabulary order. */
export const ALL_SCOPES = [
  'read:feedback',
  'write:feedback',
  'write:changelog',
  'read:article',
  'write:article',
  'read:chat',
  'write:chat',
  'read:settings',
  'write:settings',
] as const

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------

let cachedAdminKey: string | null = null

/**
 * A personal key of the seeded admin with the default scopes, made once per
 * worker. Personal, not workspace: REST honours `authorPrincipalId` (posting
 * on behalf of a customer) only for a key whose role is admin.
 */
export function adminKey(people: SeededPeople): string {
  if (!cachedAdminKey) {
    cachedAdminKey = createKey({
      creatorEmail: people.people.admin.email,
      kind: 'personal',
      name: `product mcp admin key ${Date.now()}`,
    }).key
  }
  return cachedAdminKey
}

/** REST and MCP as the worker's admin key, with a client address of its own. */
export function adminApi(
  playwright: Playwright,
  baseURL: string | undefined,
  people: SeededPeople
) {
  return apiFor(playwright, baseURL, adminKey(people))
}

/** A fresh key (see createKey) and a context authenticated with it. */
export async function keyApi(
  playwright: Playwright,
  baseURL: string | undefined,
  opts: KeyOptions
): Promise<{ api: Api; id: string; principalId: string }> {
  const created = createKey(opts)
  return { api: await apiFor(playwright, baseURL, created.key), ...created }
}

/** A context carrying an MCP OAuth token for `email` with `scopes`. */
export async function oauthApi(
  playwright: Playwright,
  baseURL: string | undefined,
  email: string,
  scopes: readonly string[]
): Promise<Api> {
  return apiFor(playwright, baseURL, mcpOAuthToken(email, [...scopes]))
}

// ---------------------------------------------------------------------------
// MCP calls whose answer is not a plain 200 tool result
// ---------------------------------------------------------------------------

export interface RawRpc {
  status: number
  headers: Record<string, string>
  body: Wire
}

/** One JSON-RPC message (or a batch), answered as status, headers and parsed body. */
export async function rawRpc(api: Api, payload: unknown): Promise<RawRpc> {
  const res = await api.post('/api/mcp', {
    headers: { accept: 'application/json, text/event-stream' },
    data: payload,
  })
  const text = await res.text()
  let body: Wire = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status(), headers: res.headers(), body }
}

let rpcSeq = 1000

/** A tools/call message. */
export function toolCallMsg(name: string, args: Record<string, unknown> = {}) {
  return { jsonrpc: '2.0', id: ++rpcSeq, method: 'tools/call', params: { name, arguments: args } }
}

/** Read one quackback:// resource; returns its first content entry. */
export async function readResource(
  api: Api,
  uri: string
): Promise<{ status: number; mimeType: string; text: string; json: Wire; raw: Wire }> {
  const res = await mcpRpc(api, 'resources/read', { uri })
  const bodyText = await res.text()
  const raw = JSON.parse(bodyText)
  const first = raw.result?.contents?.[0] ?? {}
  let json: Wire = null
  try {
    json = JSON.parse(first.text)
  } catch {
    json = null
  }
  return {
    status: res.status(),
    mimeType: first.mimeType ?? '',
    text: first.text ?? '',
    json,
    raw,
  }
}

// ---------------------------------------------------------------------------
// Seeding through REST
// ---------------------------------------------------------------------------

export interface Board {
  id: string
  slug: string
  name: string
}

/** A public board named after the marker (REST). */
export async function newBoard(admin: Api, marker: string, suffix = ''): Promise<Board> {
  const name = `${marker}${suffix ? ` ${suffix}` : ''}`.slice(0, 100)
  const res = await admin.post('/api/v1/boards', { data: { name } })
  return (await expectJson(res, 201)).data as Board
}

/** Override a board's access tiers (REST cannot set them). */
export async function setBoardAccess(
  boardId: string,
  tiers: Partial<Record<'view' | 'vote' | 'submit' | 'comment', string>>
): Promise<void> {
  await supportDb()`
    UPDATE boards SET access = access || ${supportDb().json(tiers)}
    WHERE id = ${toUuid(boardId as `board_${string}`)}`
}

export interface Post {
  id: string
  title: string
  boardId: string
  statusId: string
  voteCount: number
}

/** A post on `boardId` (REST), optionally on behalf of another principal. */
export async function newPost(
  admin: Api,
  boardId: string,
  title: string,
  extra: Record<string, unknown> = {}
): Promise<Post> {
  const res = await admin.post('/api/v1/posts', {
    data: { boardId, title, content: `${title} body`, ...extra },
  })
  return (await expectJson(res, 201)).data as Post
}

/** A comment on a post (REST), optionally on behalf of another principal. */
export async function newComment(
  admin: Api,
  postId: string,
  content: string,
  extra: Record<string, unknown> = {}
): Promise<{ id: string; postId: string; parentId: string | null }> {
  const res = await admin.post(`/api/v1/posts/${postId}/comments`, {
    data: { content, ...extra },
  })
  return (await expectJson(res, 201)).data
}

/** A post tag (REST). */
export async function newTag(
  admin: Api,
  name: string,
  isPublic = true
): Promise<{ id: string; name: string }> {
  const res = await admin.post('/api/v1/tags', { data: { name: name.slice(0, 50), isPublic } })
  return (await expectJson(res, 201)).data
}

/** The TypeID of a seeded post status by slug (open, planned, in_progress, complete, ...). */
export async function statusId(slug: string): Promise<string> {
  const [row] = await supportDb()`SELECT id FROM post_statuses WHERE slug = ${slug} LIMIT 1`
  if (!row) throw new Error(`no status ${slug}`)
  return fromUuid('post_status', row.id as string)
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

export function uuid(typeId: string): string {
  return toUuid(typeId as `post_${string}`)
}

/** The post row (snake_case columns), or null when it is gone. */
export async function postRow(postId: string): Promise<Record<string, unknown> | null> {
  const [row] = await supportDb()`SELECT * FROM posts WHERE id = ${uuid(postId)}`
  return row ?? null
}

/** Activity types recorded on a post, oldest first. */
export async function activityOf(
  postId: string
): Promise<Array<{ type: string; metadata: Wire; principal_id: string | null }>> {
  const rows = await supportDb()`
    SELECT type, metadata, principal_id FROM post_activity
    WHERE post_id = ${uuid(postId)} ORDER BY created_at, id`
  return rows as unknown as Array<{ type: string; metadata: Wire; principal_id: string | null }>
}

/** Event types recorded for an entity (or naming it in the payload), oldest first. */
export async function eventTypes(entityId: string): Promise<string[]> {
  const rows = await supportDb()`
    SELECT type FROM events
    WHERE entity_id = ${entityId} OR payload::text LIKE ${`%${entityId}%`}
    ORDER BY id`
  return rows.map((r) => r.type as string)
}

/** Wait until `type` has been recorded for an entity; returns the matching payloads. */
export async function waitForEventType(entityId: string, type: string): Promise<Wire[]> {
  return pollFor(`${type} event for ${entityId}`, async () => {
    const rows = await supportDb()`
      SELECT payload FROM events
      WHERE type = ${type} AND (entity_id = ${entityId} OR payload::text LIKE ${`%${entityId}%`})
      ORDER BY id`
    return rows.length > 0 ? rows.map((r) => r.payload) : null
  })
}

export interface AuditRow {
  event_type: string
  event_outcome: string
  channel: string | null
  credential_kind: string | null
  credential_id: string | null
  target_type: string | null
  target_id: string | null
  auth_method: string | null
  actor_type: string | null
  actor_user_id: string | null
  on_behalf_of_principal_id: string | null
  metadata: Wire
}

/**
 * mcp.tool_call audit rows for a tool, narrowed by credential, target and/or
 * the person the credential acts for (OAuth tokens all share one client id).
 */
export async function toolAudit(opts: {
  tool: string
  credentialId?: string
  targetId?: string
  onBehalfOf?: string
}): Promise<AuditRow[]> {
  const sql = supportDb()
  const rows = await sql`
    SELECT event_type, event_outcome, channel, credential_kind, credential_id, target_type,
           target_id, auth_method, actor_type, actor_user_id, on_behalf_of_principal_id, metadata
    FROM audit_log
    WHERE event_type = 'mcp.tool_call' AND metadata ->> 'tool' = ${opts.tool}
      ${opts.credentialId ? sql`AND credential_id = ${opts.credentialId}` : sql``}
      ${opts.targetId ? sql`AND target_id = ${opts.targetId}` : sql``}
      ${opts.onBehalfOf ? sql`AND on_behalf_of_principal_id = ${uuid(opts.onBehalfOf)}` : sql``}
    ORDER BY occurred_at`
  return rows as unknown as AuditRow[]
}

/** Wait for at least one audit row matching `opts`. */
export function waitForAudit(opts: Parameters<typeof toolAudit>[0]): Promise<AuditRow[]> {
  return pollFor(`mcp.tool_call audit for ${opts.tool}`, async () => {
    const rows = await toolAudit(opts)
    return rows.length > 0 ? rows : null
  })
}

// ---------------------------------------------------------------------------
// Merge suggestions (the detector needs AI; rows are seeded directly)
// ---------------------------------------------------------------------------

/** A pending merge suggestion: merge `sourcePostId` into `targetPostId`. Returns its TypeID. */
export async function seedSuggestion(sourcePostId: string, targetPostId: string): Promise<string> {
  const id = generateId('post_merge_sug')
  await supportDb()`
    INSERT INTO post_merge_suggestions
      (id, source_post_id, target_post_id, status, vector_score, fts_score, hybrid_score,
       llm_confidence)
    VALUES (${toUuid(id)}, ${uuid(sourcePostId)}, ${uuid(targetPostId)}, 'pending', 0.9, 0.9, 0.9,
            0.9)`
  return id
}

export async function suggestionRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT * FROM post_merge_suggestions WHERE id = ${uuid(id)}`
  return row
}

/** The text an MCP tool error carries, asserting it is one. */
export function expectToolError(res: { isError: boolean; text: string }, text: string | RegExp) {
  expect(res.isError, res.text).toBe(true)
  if (typeof text === 'string') expect(res.text).toBe(text)
  else expect(res.text).toMatch(text)
}

// ---------------------------------------------------------------------------
// OAuth: dynamic client registration, consent in a browser, code exchange
// ---------------------------------------------------------------------------

/** The loopback redirect a native MCP client registers; the test catches it. */
export const OAUTH_REDIRECT = 'http://127.0.0.1:47819/callback'

/** Register an MCP client by DCR. Returns the raw response. */
export function registerClient(request: Api, name: string) {
  return request.post('/api/auth/oauth2/register', {
    data: {
      client_name: name,
      redirect_uris: [OAUTH_REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  })
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/** The authorize URL a client opens, for `scope` (space separated). */
export function authorizeUrl(opts: {
  baseURL: string
  clientId: string
  scope: string
  state: string
  challenge: string
}): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: OAUTH_REDIRECT,
    scope: opts.scope,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    resource: `${opts.baseURL}/api/mcp`,
  })
  return `${opts.baseURL}/api/auth/oauth2/authorize?${q.toString()}`
}

/**
 * Catch the browser's navigation to the client's redirect URI. The returned
 * function resolves with the URL the authorization server sent the browser to.
 */
export async function catchRedirect(page: Page): Promise<() => Promise<URL>> {
  let resolveUrl: (url: URL) => void = () => {}
  const caught = new Promise<URL>((r) => (resolveUrl = r))
  await page.route(`${OAUTH_REDIRECT}**`, async (route) => {
    resolveUrl(new URL(route.request().url()))
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'caught' })
  })
  return () =>
    Promise.race([
      caught,
      new Promise<URL>((_, reject) =>
        setTimeout(() => reject(new Error(`no redirect to ${OAUTH_REDIRECT} within 15 s`)), 15_000)
      ),
    ])
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(
  request: Api,
  opts: { clientId: string; code: string; verifier: string }
): Promise<Wire> {
  const res = await request.post('/api/auth/oauth2/token', {
    form: {
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: OAUTH_REDIRECT,
      client_id: opts.clientId,
      code_verifier: opts.verifier,
    },
  })
  return expectJson(res, 200)
}
