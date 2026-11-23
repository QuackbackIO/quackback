/**
 * Helpers for the feedback inbox journeys (FBA-I-*, e2e/tests/feedback/admin-inbox.spec.ts).
 * The shared seeding helpers are in ./feedback-admin.ts.
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { callServerFn } from '../support/server-fns'
import { supportDb } from '../support/db'
import { uuid } from './feedback-admin'

/** An option in the inbox's filter pane, by its accessible name `Name, count`. */
export function filterOption(page: Page, name: string, count?: number): Locator {
  return page.getByRole('option', {
    name:
      count === undefined ? new RegExp(`^${escapeRegExp(name)}(, \\d+)?$`) : `${name}, ${count}`,
    exact: count !== undefined,
  })
}

/** A comment on a post by whoever `api` is (a teammate), via createCommentFn. */
export async function addComment(
  api: APIRequestContext,
  postId: string,
  content: string,
  opts: { isPrivate?: boolean } = {}
): Promise<string> {
  const res = await callServerFn<{ id: string }>(api, 'createCommentFn', {
    postId,
    content,
    ...opts,
  })
  if (!res.ok) throw new Error(`createCommentFn failed: ${res.raw.slice(0, 300)}`)
  return res.data.id
}

/** Set (or clear with null) a post's owner via setPostOwnerFn. */
export async function setOwner(
  api: APIRequestContext,
  postId: string,
  ownerId: string | null
): Promise<void> {
  const res = await callServerFn(api, 'setPostOwnerFn', { id: postId, ownerId })
  if (!res.ok) throw new Error(`setPostOwnerFn failed: ${res.raw.slice(0, 300)}`)
}

/** Put tags on a post via updatePostTagsFn. */
export async function setTags(
  api: APIRequestContext,
  postId: string,
  tagIds: string[]
): Promise<void> {
  const res = await callServerFn(api, 'updatePostTagsFn', { id: postId, tagIds })
  if (!res.ok) throw new Error(`updatePostTagsFn failed: ${res.raw.slice(0, 300)}`)
}

/** A pending merge suggestion between two posts (source is the likely duplicate). */
export async function insertSuggestion(
  sourcePostId: string,
  targetPostId: string
): Promise<string> {
  const id = toUuid(generateId('post_merge_suggestion'))
  await supportDb()`
    INSERT INTO post_merge_suggestions
      (id, source_post_id, target_post_id, status, vector_score, fts_score, hybrid_score, llm_confidence)
    VALUES (${id}, ${uuid(sourcePostId)}, ${uuid(targetPostId)}, 'pending', 0.9, 0.5, 0.8, 0.9)`
  return id
}

/** Set a post's timestamps or counters directly (preconditions only). */
export async function backdatePost(
  postId: string,
  fields: { createdDaysAgo?: number; deletedDaysAgo?: number; updatedDaysAgo?: number }
): Promise<void> {
  const sql = supportDb()
  const id = uuid(postId)
  if (fields.createdDaysAgo !== undefined)
    await sql`UPDATE posts SET created_at = now() - make_interval(days => ${fields.createdDaysAgo})
              WHERE id = ${id}`
  if (fields.deletedDaysAgo !== undefined)
    await sql`UPDATE posts SET deleted_at = now() - make_interval(days => ${fields.deletedDaysAgo})
              WHERE id = ${id}`
  if (fields.updatedDaysAgo !== undefined)
    await sql`UPDATE posts SET updated_at = now() - make_interval(days => ${fields.updatedDaysAgo})
              WHERE id = ${id}`
}

/** The current URL's search param, decoded the router's way (JSON when it parses). */
export function searchParam(page: Page, key: string): unknown {
  const raw = new URL(page.url()).searchParams.get(key)
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Wait until the inbox shows exactly these marker titles, in any order. */
export async function expectTitlesUnordered(
  page: Page,
  marker: string,
  titles: string[]
): Promise<void> {
  await expect
    .poll(async () => {
      const shown = await page.locator('h3').allInnerTexts()
      return shown
        .map((t) => t.trim())
        .filter((t) => t.includes(marker))
        .sort()
    })
    .toEqual([...titles].sort())
}

/**
 * One of the post modal's Manage icon buttons, found by its tooltip (the
 * buttons carry no accessible name). Throws when no button has that tooltip.
 */
export async function manageButton(page: Page, tooltip: string): Promise<Locator> {
  const buttons = page.getByRole('dialog').getByRole('complementary').getByRole('button')
  await expect(buttons.first()).toBeVisible({ timeout: 15_000 })
  for (let i = 0; i < 6; i++) {
    await buttons.nth(i).hover()
    const shown = await page
      .getByText(tooltip, { exact: true })
      .last()
      .waitFor({ state: 'visible', timeout: 1_500 })
      .then(() => true)
      .catch(() => false)
    if (shown) return buttons.nth(i)
  }
  throw new Error(`No Manage button with the tooltip "${tooltip}"`)
}

/** A manual segment holding these principals (raw uuids). */
export async function makeSegment(
  name: string,
  principalUuids: string[]
): Promise<{ id: string; name: string }> {
  const sql = supportDb()
  const id = toUuid(generateId('segment'))
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 6)}`
  await sql`INSERT INTO segments (id, name, type, slug) VALUES (${id}, ${name}, 'manual', ${slug})`
  for (const principal of principalUuids) {
    await sql`INSERT INTO user_segments (principal_id, segment_id) VALUES (${principal}, ${id})`
  }
  return { id: fromUuid('segment', id), name }
}

/** A lowercase word no other post contains (letters only, so search reads it whole). */
export function uniqueWord(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  let word = ''
  for (let i = 0; i < 10; i++) word += letters[Math.floor(Math.random() * letters.length)]
  return `zq${word}`
}

/**
 * A unique word and its first `length` letters, chosen so Postgres reads the
 * prefix as a prefix of the word. The english stemmer rewrites some prefixes
 * (`zqsvapy:*` becomes `zqsvapi:*`, which no longer starts `zqsvapywzijn`), so
 * a random prefix sometimes matches nothing and the search falls back to
 * close-spelling title matches.
 */
export async function wordWithPrefix(length = 7): Promise<{ word: string; prefix: string }> {
  const sql = supportDb()
  for (let attempt = 0; attempt < 50; attempt++) {
    const word = uniqueWord()
    const prefix = word.slice(0, length)
    const [{ found }] = await sql`SELECT to_tsvector('english', ${word})
      @@ to_tsquery('english', ${`${prefix}:*`}) AS found`
    if (found) return { word, prefix }
  }
  throw new Error('No unique word whose prefix the english stemmer keeps')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
