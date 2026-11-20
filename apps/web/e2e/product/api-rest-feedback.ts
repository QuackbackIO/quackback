/**
 * Helpers for the REST feedback specs (tests/platform/rest-comments,
 * rest-moderation, rest-taxonomy, rest-roadmaps, rest-suggestions, rest-apps).
 *
 *   const admin = await keyApi(playwright, baseURL, people)            // admin workspace key
 *   const board = await restBoard(admin.api, marker)
 *   const post = await restPost(admin.api, board.id, `${marker} post`)
 *
 * Keys are made through the app's own service (support/api-client.ts); every
 * request context gets its own client address, so the per-address rate limit
 * never couples tests. Rows the product would only make through the UI or AI
 * (held posts and comments, merge suggestions, subscriptions) are seeded by SQL.
 */
import { expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { apiFor, createKey, expectJson, newTeammate, type Wire } from '../support/api-client'
import { pollFor, supportDb } from '../support/db'
import type { SeededPeople } from '../support/people'
import { sink } from '../support/webhook-sink-client'

export const UNAUTHORIZED_MESSAGE =
  'Invalid or missing API key. Provide a valid key in the Authorization header: Bearer qb_xxx'

/** The uuid behind a TypeID. */
export function uuid(typeId: string): string {
  return toUuid(typeId as `post_${string}`)
}

export interface KeyApi {
  api: APIRequestContext
  key: string
  keyId: string
  principalId: string
}

/**
 * A request context with a fresh workspace key holding `roleKey` (default
 * admin) and `scopes` (default: none stored, full authority).
 */
export async function keyApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  people: SeededPeople,
  opts: { roleKey?: string; scopes?: string[] } = {}
): Promise<KeyApi> {
  const created = createKey({
    creatorEmail: people.people.admin.email,
    kind: 'workspace',
    roleKey: opts.roleKey ?? 'admin',
    ...(opts.scopes ? { scopes: opts.scopes } : {}),
  })
  return {
    api: await apiFor(playwright, baseURL, created.key),
    key: created.key,
    keyId: created.id,
    principalId: created.principalId,
  }
}

/**
 * A workspace key whose role holds exactly `permissions` (a fresh custom role
 * made by newTeammate; its role key is `e2e_<slug of name>`).
 */
export async function customRoleApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  people: SeededPeople,
  name: string,
  permissions: string[],
  scopes?: string[]
): Promise<KeyApi> {
  const mate = newTeammate(name, permissions)
  const [role] = await supportDb()`SELECT key FROM roles WHERE id = ${uuid(mate.roleId)}`
  return keyApi(playwright, baseURL, people, { roleKey: role.key as string, scopes })
}

/** A public board made over REST. */
export async function restBoard(api: APIRequestContext, name: string): Promise<Wire> {
  return (await expectJson(await api.post('/api/v1/boards', { data: { name } }), 201)).data
}

/** A post made over REST (the key is the author). */
export async function restPost(
  api: APIRequestContext,
  boardId: string,
  title: string,
  extra: Record<string, unknown> = {}
): Promise<Wire> {
  return (
    await expectJson(
      await api.post('/api/v1/posts', {
        data: { boardId, title, content: `${title} body`, ...extra },
      }),
      201
    )
  ).data
}

/** A comment made over REST. */
export async function restComment(
  api: APIRequestContext,
  postId: string,
  content: string,
  extra: Record<string, unknown> = {}
): Promise<Wire> {
  return (
    await expectJson(
      await api.post(`/api/v1/posts/${postId}/comments`, { data: { content, ...extra } }),
      201
    )
  ).data
}

/** The post's row (comment_count, pinned_comment_id, ...). */
export async function postRow(postId: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT * FROM posts WHERE id = ${uuid(postId)}`
  return row
}

/** The comment's row. */
export async function commentRow(commentId: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT * FROM post_comments WHERE id = ${uuid(commentId)}`
  return row
}

/** Subscribe a person to a post (all notifications), as the portal's follow does. */
export async function subscribePost(postId: string, principalId: string): Promise<void> {
  await supportDb()`
    INSERT INTO post_subscriptions (id, post_id, principal_id, reason)
    VALUES (${uuid(generateId('post_sub'))}, ${uuid(postId)}, ${uuid(principalId)}, 'manual')
    ON CONFLICT DO NOTHING`
}

/** A subscription row for a person on a post, or undefined. */
export async function subscriptionOf(
  postId: string,
  principalId: string
): Promise<Record<string, unknown> | undefined> {
  const [row] = await supportDb()`SELECT * FROM post_subscriptions
    WHERE post_id = ${uuid(postId)} AND principal_id = ${uuid(principalId)}`
  return row
}

/** Insert a comment straight into the database (no events); returns its TypeID. */
export async function seedComment(
  postId: string,
  principalId: string,
  content: string,
  opts: {
    parentId?: string
    isPrivate?: boolean
    isTeamMember?: boolean
    moderationState?: 'published' | 'pending'
    ageMinutes?: number
  } = {}
): Promise<string> {
  const id = generateId('post_comment')
  await supportDb()`
    INSERT INTO post_comments
      (id, post_id, parent_id, principal_id, content, is_team_member, is_private,
       moderation_state, created_at)
    VALUES (${uuid(id)}, ${uuid(postId)}, ${opts.parentId ? uuid(opts.parentId) : null},
            ${uuid(principalId)}, ${content}, ${opts.isTeamMember ?? false},
            ${opts.isPrivate ?? false}, ${opts.moderationState ?? 'published'},
            NOW() - make_interval(mins => ${opts.ageMinutes ?? 0}))`
  return id
}

/** Insert a held (pending) post by `principalId` on `boardId`; returns its TypeID. */
export async function seedHeldPost(
  boardId: string,
  principalId: string,
  title: string,
  ageMinutes = 0
): Promise<string> {
  const id = generateId('post')
  await supportDb()`
    INSERT INTO posts (id, board_id, title, content, principal_id, moderation_state, created_at)
    VALUES (${uuid(id)}, ${uuid(boardId)}, ${title}, ${`${title} body`}, ${uuid(principalId)},
            'pending', NOW() - make_interval(mins => ${ageMinutes}))`
  return id
}

/** Audit rows the app recorded for a target (TypeID). */
export async function auditFor(
  targetId: string,
  eventType: string
): Promise<Array<Record<string, unknown>>> {
  return supportDb()`SELECT * FROM audit_log
    WHERE target_id = ${targetId} AND event_type = ${eventType} ORDER BY occurred_at`
}

/** Wait for at least one audit row. */
export async function waitForAudit(
  targetId: string,
  eventType: string
): Promise<Array<Record<string, unknown>>> {
  return pollFor(`${eventType} audit for ${targetId}`, async () => {
    const rows = await auditFor(targetId, eventType)
    return rows.length > 0 ? rows : null
  })
}

/** post_activity rows of a post. */
export async function activityOf(
  postId: string,
  type?: string
): Promise<Array<{ type: string; principal_id: string; metadata: Wire }>> {
  const rows = await supportDb()<Array<{ type: string; principal_id: string; metadata: Wire }>>`
    SELECT type, principal_id, metadata FROM post_activity
    WHERE post_id = ${uuid(postId)} ORDER BY created_at`
  return type ? rows.filter((r) => r.type === type) : rows
}

/**
 * Run `body` with a webhook on the sink channel `channel` for `events`,
 * deleting it afterwards (the 25-webhook cap is workspace-wide).
 */
export async function withHook<T>(
  api: APIRequestContext,
  channel: string,
  events: string[],
  body: (hook: { id: string; secret: string }) => Promise<T>
): Promise<T> {
  const res = await api.post('/api/v1/webhooks', { data: { url: sink.url(channel), events } })
  expect(res.status(), await res.text()).toBe(201)
  const hook = (await res.json()).data as { id: string; secret: string }
  try {
    return await body(hook)
  } finally {
    await api.delete(`/api/v1/webhooks/${hook.id}`)
  }
}

/** The status id the workspace holds for `slug`. */
export async function statusIdBySlug(slug: string): Promise<string> {
  const [row] = await supportDb()`SELECT id FROM post_statuses
    WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`
  return fromUuid('post_status', row.id as string)
}

/** An error body: `{ error: { code, message } }` with the given status. */
export async function expectError(
  res: Awaited<ReturnType<APIRequestContext['get']>>,
  status: number,
  code: string,
  message: string | RegExp
): Promise<Wire> {
  const body = await expectJson(res, status)
  expect(body.error.code).toBe(code)
  if (typeof message === 'string') expect(body.error.message).toBe(message)
  else expect(body.error.message).toMatch(message)
  return body
}
