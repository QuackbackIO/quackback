/**
 * Helpers for the REST v1 feedback specs (tests/platform/rest-posts.spec.ts,
 * rest-votes.spec.ts).
 *
 *   const admin = await keyApi(playwright, baseURL, { creatorEmail, kind: 'workspace' })
 *   const board = await newBoard(admin.api, marker)
 *   const post = await newPost(admin.api, board.id, `${marker} title`)
 *
 * Every key is made through the app's own service (support/api-client.ts
 * createKey) and every request context carries its own client address, so the
 * 100-a-minute per-address limit never couples tests. Boards, tags and posts
 * are made over REST with an admin key (preconditions); assertions read the
 * response, the database rows the product promises, or the webhook sink.
 */
import { expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'
import { fromUuid, toUuid } from '@quackback/ids'
import { apiFor, createKey, expectJson, type KeyOptions, type Wire } from '../support/api-client'
import { pollFor, supportDb } from '../support/db'

export interface KeyedApi {
  api: APIRequestContext
  key: string
  /** The key's own service principal (TypeID). */
  principalId: string
}

/** A fresh key and a request context authenticated with it. */
export async function keyApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  opts: KeyOptions,
  extraHeaders: Record<string, string> = {}
): Promise<KeyedApi> {
  const { key, principalId } = createKey(opts)
  return { api: await apiFor(playwright, baseURL, key, extraHeaders), key, principalId }
}

/** The error envelope a refusal answers with. */
export async function expectError(
  res: Awaited<ReturnType<APIRequestContext['get']>>,
  status: number,
  code: string,
  message?: string | RegExp
): Promise<Wire> {
  const body = await expectJson(res, status)
  expect(body.error.code, JSON.stringify(body)).toBe(code)
  if (message !== undefined) {
    if (typeof message === 'string') expect(body.error.message).toBe(message)
    else expect(body.error.message).toMatch(message)
  }
  return body
}

export interface Board {
  id: string
  slug: string
  name: string
}

/** A public board only this test uses. */
export async function newBoard(api: APIRequestContext, marker: string): Promise<Board> {
  const body = await expectJson(
    await api.post('/api/v1/boards', { data: { name: `Board ${marker}`.slice(0, 100) } }),
    201
  )
  return body.data as Board
}

/** A tag only this test uses. */
export async function newTag(
  api: APIRequestContext,
  name: string
): Promise<{ id: string; name: string }> {
  const body = await expectJson(
    await api.post('/api/v1/tags', { data: { name: name.slice(0, 50) } }),
    201
  )
  return body.data
}

/** Create a post over REST and return its response body's data. */
export async function newPost(
  api: APIRequestContext,
  boardId: string,
  title: string,
  extra: Record<string, unknown> = {}
): Promise<Wire> {
  const body = await expectJson(
    await api.post('/api/v1/posts', { data: { boardId, title, content: 'Body', ...extra } }),
    201
  )
  return body.data
}

/** A post status TypeID by slug (seeded statuses: open, under_review, planned, in_progress, complete, closed). */
export async function statusIdBySlug(slug: string): Promise<string> {
  const [row] =
    await supportDb()`SELECT id FROM post_statuses WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`
  if (!row) throw new Error(`No status ${slug}`)
  return fromUuid('post_status', row.id as string)
}

export function uuid(typeId: string): string {
  return toUuid(typeId as `post_${string}`)
}

/** The post row (snake_case columns). */
export async function postRow(postId: string): Promise<Wire> {
  const [row] = await supportDb()`SELECT * FROM posts WHERE id = ${uuid(postId)}`
  return row ?? null
}

/** Tag ids on a post (TypeIDs). */
export async function postTagIds(postId: string): Promise<string[]> {
  const rows =
    await supportDb()`SELECT tag_id FROM post_tag_assignments WHERE post_id = ${uuid(postId)}`
  return rows.map((r) => fromUuid('post_tag', r.tag_id as string)).sort()
}

export interface ActivityRow {
  type: string
  principal_id: string | null
  metadata: Wire
}

/** Activity rows of a post, oldest first. */
export async function activityOf(postId: string, type?: string): Promise<ActivityRow[]> {
  const rows = (await supportDb()`
    SELECT type, principal_id, metadata FROM post_activity
    WHERE post_id = ${uuid(postId)} ORDER BY created_at, id`) as unknown as ActivityRow[]
  return type ? rows.filter((r) => r.type === type) : rows
}

/** Wait for an activity row of `type` (createActivity is fire-and-forget). */
export function waitForActivity(postId: string, type: string): Promise<ActivityRow[]> {
  return pollFor(`${type} activity on ${postId}`, async () => {
    const rows = await activityOf(postId, type)
    return rows.length > 0 ? rows : null
  })
}

/** Votes on a post: principal TypeID, source and who added it. */
export async function votesOf(postId: string): Promise<
  Array<{
    principalId: string
    sourceType: string | null
    addedBy: string | null
    createdAt: Date
  }>
> {
  const rows = await supportDb()`
    SELECT principal_id, source_type, added_by_principal_id, created_at FROM post_votes
    WHERE post_id = ${uuid(postId)}`
  return rows.map((r) => ({
    principalId: fromUuid('principal', r.principal_id as string),
    sourceType: (r.source_type as string | null) ?? null,
    addedBy: r.added_by_principal_id
      ? fromUuid('principal', r.added_by_principal_id as string)
      : null,
    createdAt: r.created_at as Date,
  }))
}

/** Subscriptions on a post: principal TypeID to reason. */
export async function subscriptionsOf(postId: string): Promise<Record<string, string>> {
  const rows = await supportDb()`
    SELECT principal_id, reason FROM post_subscriptions WHERE post_id = ${uuid(postId)}`
  return Object.fromEntries(
    rows.map((r) => [fromUuid('principal', r.principal_id as string), r.reason as string])
  )
}

/** A post's in-app notifications (bells) for a principal, by type. */
export async function bellsFor(principalId: string, postId: string): Promise<string[]> {
  const rows = await supportDb()`
    SELECT type FROM in_app_notifications
    WHERE principal_id = ${uuid(principalId)} AND post_id = ${uuid(postId)}`
  return rows.map((r) => r.type as string)
}
