/**
 * Helpers for the REST journeys over the content products and the platform
 * (tests/platform/rest-changelog, rest-status-page, rest-help-center,
 * rest-settings, rest-platform). Keys come from support/api-client.ts; this
 * file seeds the rows those journeys read and the people who receive what
 * they publish.
 */
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { apiFor, createKey, seedCustomer, type KeyOptions } from '../support/api-client'
import { supportDb } from '../support/db'
import type { SeededPeople } from '../support/people'

/** The UUID behind any TypeID. */
export function uuid(typeId: string): string {
  return toUuid(typeId as `post_${string}`)
}

/** The 401 message every v1 route answers without a valid key. */
export const UNAUTHORIZED_MESSAGE =
  'Invalid or missing API key. Provide a valid key in the Authorization header: Bearer qb_xxx'

/** A message for a scoped key that lacks the scope a permission maps to. */
export function missingScope(scope: string, permission: string): string {
  return `This API key is missing the '${scope}' scope required by '${permission}'`
}

/**
 * A workspace key held by the admin role (every permission), optionally
 * narrowed to `scopes`, and a request context for it.
 */
export async function adminApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  people: SeededPeople,
  opts: Omit<KeyOptions, 'creatorEmail'> = {}
): Promise<{ api: APIRequestContext; key: string; principalId: string; keyId: string }> {
  const created = createKey({
    creatorEmail: people.people.admin.email,
    kind: 'workspace',
    ...opts,
  })
  return {
    api: await apiFor(playwright, baseURL, created.key),
    key: created.key,
    principalId: created.principalId,
    keyId: created.id,
  }
}

/** Send `text` as the raw body of a JSON request (Playwright would re-encode a string). */
export function rawJson(
  api: APIRequestContext,
  method: 'post' | 'patch' | 'put',
  path: string,
  text = '{not json'
) {
  return api[method](path, {
    data: Buffer.from(text),
    headers: { 'content-type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Feedback rows the content products link to
// ---------------------------------------------------------------------------

/** A board of this test's own with one post on it (status `planned`). */
export async function seedPost(
  marker: string,
  title = `${marker} post`,
  voteCount = 0
): Promise<{ postId: string; boardId: string; statusName: string }> {
  const sql = supportDb()
  const boardId = generateId('board')
  await sql`INSERT INTO boards (id, slug, name) VALUES (${uuid(boardId)}, ${`${marker}-${boardId.slice(-6)}`}, ${marker})`
  const [status] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM post_statuses WHERE slug = 'planned' LIMIT 1`
  const [author] = await sql<{ id: string }[]>`
    SELECT id FROM principal WHERE role = 'admin' ORDER BY created_at LIMIT 1`
  const postId = generateId('post')
  await sql`INSERT INTO posts (id, board_id, title, content, principal_id, vote_count, status_id)
            VALUES (${uuid(postId)}, ${uuid(boardId)}, ${title}, ${`${title} body`}, ${author.id},
                    ${voteCount}, ${status.id})`
  return { postId, boardId, statusName: status.name }
}

// ---------------------------------------------------------------------------
// Changelog subscribers
// ---------------------------------------------------------------------------

export interface Subscriber {
  email: string
  principalId: string
}

/**
 * A portal customer subscribed to the changelog. `muted` turns their email
 * off (notification_preferences.email_muted) while the bell stays on.
 */
export async function seedChangelogSubscriber(
  marker: string,
  label: string,
  opts: { muted?: boolean } = {}
): Promise<Subscriber> {
  const email = `${marker}-${label}@customers.example`
  const { principalId } = await seedCustomer(email, `${label} ${marker}`)
  const sql = supportDb()
  await sql`INSERT INTO changelog_subscriptions (id, principal_id, source)
            VALUES (${toUuid(generateId('changelog_sub'))}, ${uuid(principalId)}, 'admin')`
  if (opts.muted) {
    await sql`INSERT INTO notification_preferences (id, principal_id, email_muted)
              VALUES (${toUuid(generateId('notif_pref'))}, ${uuid(principalId)}, true)`
  }
  return { email, principalId }
}

/**
 * Unsubscribe the test's subscribers again, so the changelog entries other
 * tests publish later do not mail them.
 */
export async function retireSubscribers(subscribers: Subscriber[]): Promise<void> {
  if (subscribers.length === 0) return
  await supportDb()`UPDATE changelog_subscriptions SET unsubscribed_at = NOW()
    WHERE principal_id IN ${supportDb()(subscribers.map((s) => uuid(s.principalId)))}`
}

// ---------------------------------------------------------------------------
// Rows the product writes
// ---------------------------------------------------------------------------

export interface ChangelogRow {
  principal_id: string | null
  published_at: Date | null
  notified_at: Date | null
  deleted_at: Date | null
  display_date: Date | null
}

export async function changelogRow(entryId: string): Promise<ChangelogRow | null> {
  const [row] = await supportDb()<ChangelogRow[]>`
    SELECT principal_id, published_at, notified_at, deleted_at, display_date
    FROM changelog_entries WHERE id = ${uuid(entryId)}`
  return row ?? null
}

/** `events` rows of `type` about one entity (by entity id), oldest first. */
export async function eventRows(
  entityId: string,
  type: string
): Promise<
  Array<{ actor_type: string; actor_id: string | null; payload: Record<string, unknown> }>
> {
  return supportDb()<
    Array<{ actor_type: string; actor_id: string | null; payload: Record<string, unknown> }>
  >`SELECT actor_type, actor_id, payload FROM events
    WHERE entity_id = ${entityId} AND type = ${type} ORDER BY id`
}

/** job_queue rows for a dedupe key (delayed dispatches). */
export async function jobRows(dedupeKey: string): Promise<Array<{ status: string; run_at: Date }>> {
  return supportDb()<Array<{ status: string; run_at: Date }>>`
    SELECT status, run_at FROM job_queue WHERE dedupe_key = ${dedupeKey}`
}

/** `events` rows of `type` whose payload mentions `id`, oldest first. */
export async function eventsMentioning(
  id: string,
  type: string
): Promise<
  Array<{ actor_type: string; actor_id: string | null; payload: Record<string, unknown> }>
> {
  return supportDb()<
    Array<{ actor_type: string; actor_id: string | null; payload: Record<string, unknown> }>
  >`SELECT actor_type, actor_id, payload FROM events
    WHERE type = ${type} AND payload::text LIKE ${`%${id}%`} ORDER BY id`
}

// ---------------------------------------------------------------------------
// Status page
// ---------------------------------------------------------------------------

/** A manual segment of this test's own. Returns its TypeID. */
export async function seedSegment(marker: string): Promise<string> {
  const id = generateId('segment')
  await supportDb()`INSERT INTO segments (id, name, slug)
    VALUES (${uuid(id)}, ${`${marker} segment`}, ${`${marker}-${id.slice(-6)}`})`
  return id
}

/**
 * A customer subscribed to the status page for the given services only, so
 * other tests' incidents never mail them.
 */
export async function seedStatusSubscriber(
  marker: string,
  serviceIds: string[]
): Promise<Subscriber> {
  const email = `${marker}-status@customers.example`
  const { principalId } = await seedCustomer(email, `Status ${marker}`)
  await supportDb()`INSERT INTO status_subscriptions (id, principal_id, scope, component_ids, source)
    VALUES (${toUuid(generateId('status_sub'))}, ${uuid(principalId)}, 'components',
            ${supportDb().json(serviceIds)}, 'admin')`
  return { email, principalId }
}

/** status_component_events rows for one service, oldest first. */
export async function serviceHistory(
  serviceId: string
): Promise<Array<{ status: string; source: string }>> {
  return supportDb()<Array<{ status: string; source: string }>>`
    SELECT status, source FROM status_component_events
    WHERE component_id = ${uuid(serviceId)} ORDER BY created_at, id`
}

/** job_queue rows whose dedupe key starts with `prefix`. */
export async function jobRowsLike(
  prefix: string
): Promise<Array<{ dedupe_key: string; status: string }>> {
  return supportDb()<Array<{ dedupe_key: string; status: string }>>`
    SELECT dedupe_key, status FROM job_queue WHERE dedupe_key LIKE ${`${prefix}%`}`
}

/** The role key `newTeammate(name, ...)` gives the teammate's own role. */
export function roleKeyOf(teammateName: string): string {
  const slug = teammateName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `e2e_${slug.replace(/-/g, '_')}`
}

/** The principal TypeID of a raw principal UUID. */
export function principalTypeId(raw: string): string {
  return fromUuid('principal', raw)
}
