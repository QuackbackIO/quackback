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

export { personApi, callServerFn } from '../support/server-fns'

/** The fixed placeholder principal removed people's content is re-pointed to. */
export const DELETED_USER_PRINCIPAL = 'principal_00000000000000000000000000'

function suffix(): string {
  return randomBytes(3).toString('hex')
}

/** A public board only this test uses. */
export async function seedBoard(
  marker: string
): Promise<{ id: string; slug: string; name: string }> {
  const uuid = toUuid(generateId('board'))
  const slug = `${marker}-${suffix()}`.slice(0, 60)
  const name = `Board ${marker}`.slice(0, 90)
  await supportDb()`INSERT INTO boards (id, slug, name, description)
                    VALUES (${uuid}, ${slug}, ${name}, 'people e2e board')`
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

/** Call a server function expecting a refusal; returns the result. */
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
