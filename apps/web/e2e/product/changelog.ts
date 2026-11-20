/**
 * Changelog helpers for the product suite (e2e/tests/changelog/).
 *
 * Entries are created through the admin's server functions (the product's own
 * write path), titled with the test's marker, and soft-deleted afterwards
 * (`retireChangelog`). Subscribers are the test's own customers with a
 * changelog_subscriptions row; every publish in the workspace mails every
 * active subscriber, so tests only ever look at their own subscribers'
 * mail, by recipient and the entry's title, and opt them out afterwards.
 *
 *   const admin = await personApi(playwright, 'admin')
 *   const sub = await changelogSubscriber(marker)
 *   const entry = await createEntry(admin, { title: `${marker} ships`, state: 'published' })
 *   await waitForMail({ to: sub.email, subject: entry.title })
 */
import { expect, type APIRequestContext } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { pollFor, supportDb } from '../support/db'
import { mailTo } from '../support/mailpit'
import { callServerFn } from '../support/server-fns'
import { mintCustomer, type MintedCustomer } from '../support/widget-portal'
import { waitForEventHandled } from '../support/bells'
import { apiFor, createKey, expectJson } from '../support/api-client'
import { supportEnv } from '../support/env'
import type { SeededPeople } from '../support/people'

type Playwright = Parameters<typeof apiFor>[0]
let workerKey: string | null = null

/** REST as the admin, with a workspace key made once per worker. Dispose it. */
export async function adminRest(playwright: Playwright, people: SeededPeople) {
  workerKey ??= createKey({
    creatorEmail: people.people.admin.email,
    kind: 'workspace',
    name: 'changelog e2e',
  }).key
  return apiFor(playwright, supportEnv().baseUrl, workerKey)
}

/**
 * A shipped post (status in the complete category) on a board of its own,
 * made through REST. Returns ids and the board slug.
 */
export async function shippedPost(
  rest: APIRequestContext,
  marker: string,
  title = `${marker} shipped post`
): Promise<{ id: string; title: string; boardSlug: string; statusName: string }> {
  const slug = `${marker}-${generateId('board').slice(-6)}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
  const board = (
    await expectJson(
      await rest.post('/api/v1/boards', { data: { name: `${marker} board`, slug } }),
      201
    )
  ).data
  const [status] = await supportDb()`SELECT id, name FROM post_statuses
    WHERE category = 'complete' AND deleted_at IS NULL ORDER BY position LIMIT 1`
  const post = (
    await expectJson(
      await rest.post('/api/v1/posts', {
        data: { boardId: board.id, title, statusId: fromUuid('post_status', status.id as string) },
      }),
      201
    )
  ).data
  return { id: post.id, title, boardSlug: board.slug, statusName: String(status.name) }
}

/** A manual segment with these principals (uuid) in it. Returns its TypeID. */
export async function segmentWith(marker: string, principalUuids: string[]): Promise<string> {
  const id = generateId('segment')
  await supportDb()`INSERT INTO segments (id, name, slug, type)
    VALUES (${toUuid(id)}, ${`${marker} segment`}, ${`${marker}-${id.slice(-6)}`.toLowerCase()}, 'manual')`
  for (const p of principalUuids) {
    await supportDb()`INSERT INTO user_segments (principal_id, segment_id) VALUES (${p}, ${toUuid(id)})`
  }
  return id
}

/** Make an entry's delayed announcement job due now (only this entry's). */
export async function makeJobDue(entryId: string): Promise<void> {
  await supportDb()`UPDATE job_queue SET run_at = now() - interval '1 second'
    WHERE job_id = ${`changelog-publish--${entryId}`} AND status = 'pending'`
}

export interface Entry {
  id: string
  title: string
  publishedAt: string | null
  displayDate: string | null
}

export type EntryState =
  | { type: 'draft' }
  | { type: 'published'; publishAt?: string }
  | { type: 'scheduled'; publishAt: string }

export interface EntryInput {
  title: string
  content?: string
  state?: 'draft' | 'published' | EntryState
  notify?: boolean
  categoryIds?: string[]
  linkedPostIds?: string[]
  segmentIds?: string[]
  displayDate?: string | null
  featuredImageUrl?: string | null
}

const entries: string[] = []
const subscribers: string[] = []
const categories: string[] = []

function stateOf(state: EntryInput['state']): EntryState {
  if (!state || state === 'draft') return { type: 'draft' }
  if (state === 'published') return { type: 'published' }
  return state
}

/** Create an entry as whoever `api` is (createChangelogFn). */
export async function createEntry(api: APIRequestContext, input: EntryInput): Promise<Entry> {
  const { state, content, ...rest } = input
  const res = await callServerFn<Entry>(api, 'createChangelogFn', {
    content: content ?? `${input.title} body text.`,
    publishState: stateOf(state),
    ...rest,
  })
  expect(res.ok, res.error).toBe(true)
  entries.push(res.data.id)
  return res.data
}

/** Update an entry (updateChangelogFn); returns the raw result. */
export function updateEntry(api: APIRequestContext, id: string, data: Record<string, unknown>) {
  return callServerFn<Entry>(api, 'updateChangelogFn', { id, ...data })
}

/** Track an entry made another way (the admin UI) for `retireChangelog`. */
export function trackEntry(id: string): void {
  entries.push(id)
}

/** A label (changelog category) the test owns. */
export async function createLabel(
  api: APIRequestContext,
  name: string,
  segmentIds: string[] = []
): Promise<{ id: string; name: string }> {
  const res = await callServerFn<{ id: string; name: string }>(api, 'createChangelogCategoryFn', {
    name,
    color: '#0ea5e9',
    ...(segmentIds.length ? { segmentIds } : {}),
  })
  expect(res.ok, res.error).toBe(true)
  categories.push(res.data.id)
  return res.data
}

/** A customer with an active changelog subscription (source admin). */
export async function changelogSubscriber(marker: string, tag = 'sub'): Promise<MintedCustomer> {
  const customer = await mintCustomer({ email: `${marker}-${tag}@customers.example` })
  await subscribe(customer.principalUuid)
  return customer
}

/** Give a principal (uuid) an active changelog subscription. */
export async function subscribe(principalUuid: string): Promise<void> {
  await supportDb()`INSERT INTO changelog_subscriptions (id, principal_id, source)
    VALUES (${toUuid(generateId('changelog_sub'))}, ${principalUuid}, 'admin')
    ON CONFLICT (principal_id) DO UPDATE SET unsubscribed_at = NULL`
  subscribers.push(principalUuid)
}

/** Track a principal (uuid) that got subscribed some other way. */
export function trackSubscriber(principalUuid: string): void {
  subscribers.push(principalUuid)
}

/** The changelog_subscriptions row of a principal (uuid), if any. */
export async function subscriptionOf(principalUuid: string) {
  const [row] = await supportDb()`SELECT source, unsubscribed_at FROM changelog_subscriptions
    WHERE principal_id = ${principalUuid}`
  return row ?? null
}

/** Soft-delete this worker's entries and labels, and opt its subscribers out. */
export async function retireChangelog(): Promise<void> {
  const ids = entries.splice(0).map((id) => toUuid(id as `changelog_${string}`))
  if (ids.length) {
    await supportDb()`UPDATE changelog_entries SET deleted_at = now(),
        notified_at = coalesce(notified_at, now())
      WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL`
  }
  const subs = subscribers.splice(0)
  if (subs.length) {
    await supportDb()`UPDATE changelog_subscriptions SET unsubscribed_at = now()
      WHERE principal_id = ANY(${subs}::uuid[]) AND unsubscribed_at IS NULL`
  }
  const cats = categories.splice(0).map((id) => toUuid(id as `changelog_category_${string}`))
  if (cats.length) {
    await supportDb()`DELETE FROM changelog_entry_categories WHERE category_id = ANY(${cats}::uuid[])`
    await supportDb()`DELETE FROM changelog_categories WHERE id = ANY(${cats}::uuid[])`
  }
}

/** The entry's row. */
export async function entryRow(id: string) {
  const [row] = await supportDb()`SELECT * FROM changelog_entries
    WHERE id = ${toUuid(id as `changelog_${string}`)}`
  return row
}

/** Mail to `to` whose subject carries `title`. */
export async function announcementsTo(to: string, title: string) {
  return (await mailTo(to)).filter((m) => m.Subject.includes(title))
}

/**
 * Wait until the entry's changelog.published event and every job it queued
 * have run: after this no announcement mail or bell for it is still coming.
 */
export function waitForAnnouncementHandled(entryId: string): Promise<string> {
  return waitForEventHandled(entryId, { type: 'changelog.published', timeoutMs: 30_000 })
}

/** How many changelog.published events name the entry. */
export async function announcementEvents(entryId: string): Promise<number> {
  const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM events
    WHERE type = 'changelog.published' AND payload::text LIKE ${`%${entryId}%`}`
  return n as number
}

/** The pending delayed announcement job of an entry, if any. */
export async function publishJob(entryId: string) {
  const [row] = await supportDb()`SELECT job_id, run_at, status FROM job_queue
    WHERE job_id = ${`changelog-publish--${entryId}`} AND status = 'pending'`
  return row ?? null
}

/** Wait for a condition on the entry's row (notified_at stamped, say). */
export function waitForEntry(
  id: string,
  what: string,
  match: (row: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  return pollFor(`changelog ${id}: ${what}`, async () => {
    const row = await entryRow(id)
    return row && match(row) ? row : null
  })
}

export { fromUuid }
