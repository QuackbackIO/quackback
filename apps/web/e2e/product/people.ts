/**
 * Helpers for the people specs (e2e/tests/people/users*, companies,
 * user-attributes): portal users with their own activity, boards, posts,
 * votes and comments made the way the portal makes them, REST keys, and the
 * admin's server functions.
 *
 *   const board = await seedBoard(marker)
 *   const cass = await portalUser(browser, marker)          // signed-in portal user
 *   const post = await postAs(cass.api, board.id, `Idea ${marker}`)
 *   await voteAs(cass.api, post.id)
 *   const admin = await personApi(playwright, 'admin')
 *   await adminCall(admin, 'deletePortalUserFn', { principalId: cass.principalId })
 *
 * Every row a test makes carries its marker, so tests find their own rows by
 * search and never by position or count.
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
import { apiFor, createKey, type CreatedKey } from '../support/api-client'
import { callServerFn, type ServerFnResult } from '../support/server-fns'
import { mintCustomer, portalContext, type MintedCustomer } from '../support/widget-portal'

export { personApi } from '../support/server-fns'

/** The fixed placeholder principal removed people's content is re-pointed to. */
export const DELETED_USER_PRINCIPAL = 'principal_00000000000000000000000000'

function suffix(): string {
  return randomBytes(3).toString('hex')
}

/** A public board only this test uses. */
export async function seedBoard(
  marker: string,
  opts: { teamOnly?: boolean } = {}
): Promise<{ id: string; slug: string; name: string }> {
  const uuid = toUuid(generateId('board'))
  const slug = `${marker}-${suffix()}`.slice(0, 60)
  const name = `Board ${marker}`.slice(0, 90)
  const sql = supportDb()
  await sql`INSERT INTO boards (id, slug, name, description)
            VALUES (${uuid}, ${slug}, ${name}, 'people e2e board')`
  if (opts.teamOnly) {
    // A private board: every action limited to the team.
    await sql`UPDATE boards SET access = access || '{"view":"team","vote":"team","comment":"team","submit":"team"}'::jsonb
              WHERE id = ${uuid}`
  }
  return { id: fromUuid('board', uuid), slug, name }
}

export interface PortalUser extends MintedCustomer {
  /** A browser context signed in to the portal as them. */
  context: BrowserContext
  /** That context's request client (cookie-authed server functions). */
  api: APIRequestContext
}

/**
 * A fresh identified portal user, signed in. `name` defaults to one carrying
 * the marker so a directory search for the marker finds them.
 */
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

/** A portal user with no session (only rows). */
export async function portalUserRow(
  marker: string,
  opts: { name?: string; email?: string; verified?: boolean } = {}
): Promise<MintedCustomer> {
  const s = suffix()
  const customer = await mintCustomer({
    email: opts.email ?? `${marker}-${s}@customers.example`,
    name: opts.name ?? `Person ${marker} ${s}`,
  })
  if (opts.verified === false) {
    await supportDb()`UPDATE "user" SET email_verified = false WHERE id = ${customer.userUuid}`
  }
  return customer
}

/**
 * An anonymous "lead": an anonymous principal shaped like the anonymous auth
 * plugin makes one (placeholder email on the reserved domain), optionally
 * with a captured contact email.
 */
export async function seedLead(
  marker: string,
  opts: { contactEmail?: string | null; name?: string } = {}
): Promise<MintedCustomer> {
  const sql = supportDb()
  const userUuid = toUuid(generateId('user'))
  const principalUuid = toUuid(generateId('principal'))
  const email = `temp-${userUuid}@anon.quackback.io`
  const name = opts.name ?? `Lead ${marker} ${suffix()}`
  await sql`INSERT INTO "user" (id, name, email, email_verified, is_anonymous, created_at, updated_at)
            VALUES (${userUuid}, ${name}, ${email}, false, true, NOW(), NOW())`
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, contact_email, created_at)
            VALUES (${principalUuid}, ${userUuid}, 'user', 'anonymous', ${name},
                    ${opts.contactEmail ?? null}, NOW())`
  return {
    email,
    name,
    userId: fromUuid('user', userUuid),
    principalId: fromUuid('principal', principalUuid),
    userUuid,
    principalUuid,
  }
}

/** Server functions the people specs call that are GETs. */
const GET_FNS = new Set([
  'listPortalUsersFn',
  'getPortalUserFn',
  'listDuplicateUsersFn',
  'listUserTagsFn',
  'listUserTagsForPrincipalFn',
  'getPersonBlockStatusFn',
  'getChangelogSubscriptionStatusFn',
  'getProfileTeamContextFn',
  'searchPeopleFn',
  'listCompaniesFn',
  'getCompanyFn',
  'listCompanyAttributesFn',
  'listUserAttributesFn',
])

function methodOf(name: string, method?: 'POST' | 'GET'): 'POST' | 'GET' {
  return method ?? (GET_FNS.has(name) ? 'GET' : 'POST')
}

/** Call a server function by name; GETs are known by name (GET_FNS). */
export function call<T = unknown>(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { sourceFile?: string; method?: 'POST' | 'GET' } = {}
): Promise<ServerFnResult<T>> {
  return callServerFn<T>(api, name, data, { ...opts, method: methodOf(name, opts.method) })
}

/** Call a server function and fail the test when it throws. */
export async function mustCall<T = unknown>(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { sourceFile?: string; method?: 'POST' | 'GET' } = {}
): Promise<T> {
  const res = await call<T>(api, name, data, opts)
  expect(res.ok, `${name}: ${res.raw.slice(0, 400)}`).toBe(true)
  return res.data
}

/** Call a server function expecting a refusal; returns the result. */
export async function refusedCall(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { sourceFile?: string; method?: 'POST' | 'GET' } = {}
): Promise<ServerFnResult> {
  const res = await call(api, name, data, opts)
  expect(res.ok, `${name} should be refused: ${res.raw.slice(0, 300)}`).toBe(false)
  return res
}

/** The portal user files a post on a board (createPublicPostFn). */
export async function postAs(
  api: APIRequestContext,
  boardId: string,
  title: string
): Promise<{ id: string }> {
  const post = await mustCall<{ id: string }>(api, 'createPublicPostFn', {
    boardId,
    title,
    content: `Body of ${title}`,
  })
  return { id: post.id }
}

/** The portal user toggles their vote on a post. */
export async function voteAs(
  api: APIRequestContext,
  postId: string
): Promise<{ voted: boolean; voteCount: number }> {
  return mustCall(api, 'toggleVoteFn', { postId })
}

/** The portal user comments on a post. */
export async function commentAs(
  api: APIRequestContext,
  postId: string,
  content: string
): Promise<{ id: string }> {
  const res = await mustCall<{ comment?: { id: string }; id?: string }>(api, 'createCommentFn', {
    postId,
    content,
  })
  const id = res.comment?.id ?? res.id
  if (!id) throw new Error(`createCommentFn answered without an id: ${JSON.stringify(res)}`)
  return { id }
}

/** posts.vote_count for a post. */
export async function voteCountOf(postId: string): Promise<number> {
  const [row] =
    await supportDb()`SELECT vote_count FROM posts WHERE id = ${toUuid(postId as `post_${string}`)}`
  if (!row) throw new Error(`no post ${postId}`)
  return Number(row.vote_count)
}

/** Live post_votes rows for a post. */
export async function voteRowsOf(postId: string): Promise<number> {
  const [row] = await supportDb()`SELECT count(*)::int AS n FROM post_votes
                                  WHERE post_id = ${toUuid(postId as `post_${string}`)}`
  return Number(row.n)
}

export function uuid(typeId: string): string {
  return toUuid(typeId as `principal_${string}`)
}

// ---------------------------------------------------------------------------
// REST keys
// ---------------------------------------------------------------------------

let adminKey: CreatedKey | null = null

/**
 * A workspace key holding the admin role (every permission), made once per
 * worker. For tests that need a narrower key, call createKey directly.
 */
export function adminWorkspaceKey(): CreatedKey {
  adminKey ??= createKey({
    creatorEmail: 'e2e-support-admin@example.com',
    kind: 'workspace',
    roleKey: 'admin',
  })
  return adminKey
}

/** A REST client with the per-worker admin workspace key. */
export async function restAdmin(
  playwright: PlaywrightWorkerArgs['playwright']
): Promise<APIRequestContext> {
  return apiFor(playwright, supportEnv().baseUrl, adminWorkspaceKey().key)
}

/** A REST client with a workspace key holding `roleKey`. */
export async function restAs(
  playwright: PlaywrightWorkerArgs['playwright'],
  roleKey: string
): Promise<APIRequestContext> {
  const { key } = createKey({
    creatorEmail: 'e2e-support-admin@example.com',
    kind: 'workspace',
    roleKey,
  })
  return apiFor(playwright, supportEnv().baseUrl, key)
}

// ---------------------------------------------------------------------------
// Admin UI
// ---------------------------------------------------------------------------

/** The People directory, searched for `search`, with a profile open. */
export function usersUrl(opts: {
  search?: string
  selected?: string
  lifecycle?: 'leads'
}): string {
  const q = new URLSearchParams()
  if (opts.search) q.set('search', opts.search)
  if (opts.selected) q.set('selected', opts.selected)
  if (opts.lifecycle) q.set('lifecycle', opts.lifecycle)
  const s = q.toString()
  return `/admin/users${s ? `?${s}` : ''}`
}

/** A teammate's or portal user's name/email/verified straight from the rows. */
export async function userRow(userUuid: string): Promise<{
  name: string
  email: string | null
  email_verified: boolean
  metadata: string | null
}> {
  const [row] = await supportDb()`SELECT name, email, email_verified, metadata FROM "user"
                                  WHERE id = ${userUuid}`
  if (!row) throw new Error(`no user ${userUuid}`)
  return row as never
}

/** The workspace's post status id by slug (open, planned, complete, ...). */
export async function postStatusId(slug: string): Promise<string> {
  const [row] = await supportDb()`SELECT id FROM post_statuses WHERE slug = ${slug} LIMIT 1`
  if (!row) throw new Error(`no post status ${slug}`)
  return fromUuid('post_status', row.id as string)
}

/**
 * Activity a lead left while anonymous interaction was on (the suite's
 * workspace has it off, so leads cannot act through the portal here). Each
 * row is written as the vote, post and comment paths write it, counters
 * included.
 */
export async function seedLeadActivity(
  leadPrincipalUuid: string,
  act:
    | { vote: string }
    | { post: { boardId: string; title: string } }
    | { comment: { postId: string; content: string } }
): Promise<string> {
  const sql = supportDb()
  if ('vote' in act) {
    const id = toUuid(generateId('vote'))
    await sql.begin(async (tx) => {
      await tx`INSERT INTO post_votes (id, post_id, principal_id)
               VALUES (${id}, ${uuid(act.vote)}, ${leadPrincipalUuid})`
      await tx`UPDATE posts SET vote_count = vote_count + 1 WHERE id = ${uuid(act.vote)}`
    })
    return fromUuid('vote', id)
  }
  if ('post' in act) {
    const id = toUuid(generateId('post'))
    await sql`INSERT INTO posts (id, board_id, title, content, principal_id)
              VALUES (${id}, ${uuid(act.post.boardId)}, ${act.post.title}, '', ${leadPrincipalUuid})`
    return fromUuid('post', id)
  }
  const id = toUuid(generateId('comment'))
  await sql.begin(async (tx) => {
    await tx`INSERT INTO post_comments (id, post_id, principal_id, content)
             VALUES (${id}, ${uuid(act.comment.postId)}, ${leadPrincipalUuid}, ${act.comment.content})`
    await tx`UPDATE posts SET comment_count = comment_count + 1
             WHERE id = ${uuid(act.comment.postId)}`
  })
  return fromUuid('comment', id)
}

/** A browser context signed in as a lead (anonymous principal with a session). */
export async function leadContext(
  browser: Browser,
  lead: Pick<MintedCustomer, 'userUuid'>
): Promise<BrowserContext> {
  return portalContext(browser, lead)
}

/** A user attribute definition with a fresh key; returns the key. */
export async function seedUserAttribute(
  type: 'string' | 'number' | 'boolean' | 'date' | 'currency',
  opts: { label?: string; currencyCode?: string } = {}
): Promise<string> {
  const key = `e2e_${type}_${suffix()}${suffix()}`
  await supportDb()`INSERT INTO user_attribute_definitions (id, key, label, type, currency_code)
    VALUES (${toUuid(generateId('user_attr'))}, ${key}, ${opts.label ?? key}, ${type},
            ${opts.currencyCode ?? (type === 'currency' ? 'USD' : null)})`
  return key
}

/** A user's metadata JSON (attributes live here). */
export async function metadataOf(userUuid: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT metadata FROM "user" WHERE id = ${userUuid}`
  return row?.metadata ? (JSON.parse(row.metadata as string) as Record<string, unknown>) : {}
}

export interface AuditRow {
  event_type: string
  before_value: Record<string, unknown> | null
  after_value: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

/** Audit rows of one event type for a target id, oldest first. */
export async function auditRows(eventType: string, targetId: string): Promise<AuditRow[]> {
  return supportDb()<AuditRow[]>`SELECT event_type, before_value, after_value, metadata
    FROM audit_log WHERE event_type = ${eventType} AND target_id = ${targetId}
    ORDER BY occurred_at`
}
