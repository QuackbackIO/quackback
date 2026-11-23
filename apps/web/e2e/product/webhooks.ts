/**
 * Helpers for the outgoing-webhook product specs
 * (tests/platform/webhooks-*.spec.ts, journeys API-W-*).
 *
 *   const api = await adminApi(playwright, baseURL, people, marker)
 *   const board = await newBoard(api, marker)
 *   await withHook(api, marker, ['post.created'], async (hook) => {
 *     const post = await newPost(api, board.id, `Title ${marker}`)
 *     const [d] = await deliveriesOf(marker, 'post.created', post.id)
 *   })
 *
 * Every webhook is deleted in `finally`: the 25-webhook cap is workspace-wide
 * and every parallel worker shares it. "Not delivered" is only ever asserted
 * after a positive control on the same channel has arrived (`expectNone`).
 */
import { expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'
import { generateId, toUuid } from '@quackback/ids'
import { supportDb } from '../support/db'
import type { SeededPeople } from '../support/people'
import { sink, type SinkDelivery } from '../support/webhook-sink-client'
import { deliveriesOf, hooksApi, unsubscribe, type Hook } from '../support/webhooks'

export type Api = APIRequestContext
export type Json = Record<string, unknown>

/** REST context with a fresh personal key of the seeded admin. */
export function adminApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  people: SeededPeople,
  marker: string
): Promise<Api> {
  return hooksApi(playwright, baseURL, people, marker)
}

/** Read a JSON body, failing with the raw text when the status differs. */
export async function json<T = Json>(res: Awaited<ReturnType<Api['get']>>, status: number) {
  const text = await res.text()
  expect(res.status(), text).toBe(status)
  return (text ? JSON.parse(text) : null) as T
}

export interface Board {
  id: string
  slug: string
  name: string
}

/** A public board only this test uses. */
export async function newBoard(api: Api, marker: string, suffix = 'a'): Promise<Board> {
  const name = `Hooks ${marker} ${suffix}`
  const { data } = await json<{ data: Board }>(
    await api.post('/api/v1/boards', { data: { name } }),
    201
  )
  return data
}

export interface Post {
  id: string
  title: string
  boardId: string
  statusId: string | null
}

/** Create a post over REST (as the key, or on behalf of `authorPrincipalId`). */
export async function newPost(
  api: Api,
  boardId: string,
  title: string,
  extra: Json = {},
  headers: Record<string, string> = {}
): Promise<Post> {
  const { data } = await json<{ data: Post }>(
    await api.post('/api/v1/posts', { data: { boardId, title, ...extra }, headers }),
    201
  )
  return data
}

/** Create a comment over REST. */
export async function newComment(
  api: Api,
  postId: string,
  content: string,
  extra: Json = {}
): Promise<{ id: string }> {
  const { data } = await json<{ data: { id: string } }>(
    await api.post(`/api/v1/posts/${postId}/comments`, { data: { content, ...extra } }),
    201
  )
  return data
}

/** A post status id by slug (open, planned, in_progress, complete, closed). */
export async function statusId(api: Api, slug: string): Promise<string> {
  const { data } = await json<{ data: Array<{ id: string; slug: string }> }>(
    await api.get('/api/v1/statuses'),
    200
  )
  const found = data.find((s) => s.slug === slug)
  if (!found) throw new Error(`no status ${slug} in ${data.map((s) => s.slug).join(', ')}`)
  return found.id
}

/** Create a webhook on the sink channel, failing loudly on refusal. */
export async function createHook(
  api: Api,
  channel: string,
  events: string[],
  boardIds?: string[]
): Promise<Hook & Json> {
  const { data } = await json<{ data: Hook & Json }>(
    await api.post('/api/v1/webhooks', {
      data: { url: sink.url(channel), events, ...(boardIds ? { boardIds } : {}) },
    }),
    201
  )
  return data
}

/** Run `body` with webhooks on the given channels; always deletes them. */
export async function withHooks<T>(
  api: Api,
  specs: Array<{ channel: string; events: string[]; boardIds?: string[] }>,
  body: (hooks: Array<Hook & Json>) => Promise<T>
): Promise<T> {
  const hooks: Array<Hook & Json> = []
  try {
    for (const s of specs) hooks.push(await createHook(api, s.channel, s.events, s.boardIds))
    return await body(hooks)
  } finally {
    for (const h of hooks) await unsubscribe(api, h)
  }
}

/** One webhook on `channel`, deleted afterwards. */
export function withHook<T>(
  api: Api,
  channel: string,
  events: string[],
  body: (hook: Hook & Json) => Promise<T>,
  boardIds?: string[]
): Promise<T> {
  return withHooks(api, [{ channel, events, boardIds }], ([hook]) => body(hook))
}

/** GET one webhook. */
export async function getHook(api: Api, id: string): Promise<Json> {
  return (await json<{ data: Json }>(await api.get(`/api/v1/webhooks/${id}`), 200)).data
}

/** The delivery's event header. */
export function eventOf(d: SinkDelivery): string {
  return d.headers['x-quackback-event']
}

/** Deliveries on `channel` of `type` whose body mentions `needle`, right now. */
export async function deliveredNow(
  channel: string,
  type: string,
  needle: string
): Promise<SinkDelivery[]> {
  return (await sink.deliveries(channel)).filter(
    (d) => eventOf(d) === type && d.body.includes(needle)
  )
}

/**
 * Assert nothing matching `where` reached `channel`. Call it only after a
 * positive control on the same channel has been delivered (the event queue
 * runs in order of enqueue); a short settle covers a concurrent job.
 */
export async function expectNone(
  channel: string,
  where: (d: SinkDelivery) => boolean,
  what: string,
  settleMs = 2_000
): Promise<void> {
  await new Promise((r) => setTimeout(r, settleMs))
  const found = (await sink.deliveries(channel)).filter(where)
  expect(
    found.map((d) => `${eventOf(d)} ${d.body.slice(0, 200)}`),
    what
  ).toEqual([])
}

/** A match for `type` naming `needle` in the body. */
export function is(type: string, needle: string): (d: SinkDelivery) => boolean {
  return (d) => eventOf(d) === type && d.body.includes(needle)
}

/** Events rows of `type` for an entity (by entity id or a payload mention). */
export async function eventRows(
  type: string,
  entityId: string
): Promise<Array<{ payload: Json; published_at: Date | null }>> {
  const sql = supportDb()
  return (await sql`SELECT payload, published_at FROM events
    WHERE type = ${type} AND (entity_id = ${entityId} OR payload::text LIKE ${`%${entityId}%`})
    ORDER BY id`) as never
}

/** Set a webhook's failure counters straight in the database. */
export async function setHookCounters(
  id: string,
  counters: { failureCount?: number; lastError?: string | null; status?: 'active' | 'disabled' }
): Promise<void> {
  const sql = supportDb()
  const uuid = toUuid(id as `webhook_${string}`)
  if (counters.failureCount !== undefined)
    await sql`UPDATE webhooks SET failure_count = ${counters.failureCount} WHERE id = ${uuid}`
  if (counters.lastError !== undefined)
    await sql`UPDATE webhooks SET last_error = ${counters.lastError} WHERE id = ${uuid}`
  if (counters.status !== undefined) {
    await sql`UPDATE webhooks SET status = ${counters.status} WHERE id = ${uuid}`
    // The resolver caches the active list for 300 s; a raw write must drop it.
    await sql`DELETE FROM kv_store WHERE key LIKE '%webhooks-active%'`
  }
}

/**
 * A test customer (the widget-preview identity a teammate gets): a portal
 * user whose principal names a test owner. Their content is never delivered.
 */
export async function seedTestCustomer(
  ownerPrincipalId: string,
  marker: string
): Promise<{ principalId: string }> {
  const sql = supportDb()
  const userId = toUuid(generateId('user'))
  await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
            VALUES (${userId}, ${`Test ${marker}`}, ${`${marker}-test@customers.example`}, true, NOW(), NOW())`
  const principalTypeId = generateId('principal')
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, test_owner_principal_id, created_at)
            VALUES (${toUuid(principalTypeId)}, ${userId}, 'user', 'user', ${`Test ${marker}`},
                    ${toUuid(ownerPrincipalId as `principal_${string}`)}, NOW())`
  return { principalId: principalTypeId }
}

/**
 * Deliveries of `type` on `channel` naming `entityId`: the support helper with
 * a longer wait, since the shared events queue also runs every post's AI jobs.
 */
export function delivered(
  channel: string,
  type: string,
  entityId: string,
  opts: { count?: number; timeoutMs?: number } = {}
): Promise<SinkDelivery[]> {
  return deliveriesOf(channel, type, entityId, { timeoutMs: 45_000, ...opts })
}
