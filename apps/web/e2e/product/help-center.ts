/**
 * Help center helpers for the product suite (e2e/tests/help-center/).
 *
 *   const hc = await hcApi(playwright)                 // REST as the admin (personal key)
 *   const cat = await hcCategory(hc, `Guides ${marker}`)
 *   const art = await hcArticle(hc, { categoryId: cat.id, title: `... ${word}`, publish: true })
 *   await page.goto(articlePath(art))                  // /hc/en/articles/<urlId>-<slug>
 *
 * Seeding goes through the product's REST API (markdown in, the editor JSON
 * and the search vector built by the app), so a seeded article looks exactly
 * like one an admin wrote. Rows are found by the marker in their names.
 *
 * Search note: the fake AI's embeddings are hash vectors, so only keyword
 * matching finds anything. Put a single alphanumeric `searchWord()` in a title
 * and search for it; the hyphenated marker is split by the text parser.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'
import { expect } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { apiFor, createKey, expectJson, type Wire } from '../support/api-client'
import { supportDb } from '../support/db'
import { supportEnv } from '../support/env'
import { SEEDED_PEOPLE_FILE, SUPPORT_PEOPLE, type SeededPeople } from '../support/people'

/** One admin personal key per worker (minting one runs a script). */
let adminKey: string | null = null

export function hcAdminKey(): string {
  adminKey ??= createKey({ creatorEmail: SUPPORT_PEOPLE.admin.email, kind: 'personal' }).key
  return adminKey
}

/** The seeded admin's principal TypeID (the default article author). */
export function adminPrincipalId(): string {
  const seeded = JSON.parse(readFileSync(SEEDED_PEOPLE_FILE, 'utf8')) as SeededPeople
  return seeded.people.admin.principalId
}

/** A REST context authenticated as the admin, with its own client address. */
export function hcApi(playwright: PlaywrightWorkerArgs['playwright']): Promise<APIRequestContext> {
  return apiFor(playwright, supportEnv().baseUrl, hcAdminKey())
}

/** A token the search parser keeps whole: `zq` and hex, no hyphen. */
export function searchWord(): string {
  return `zq${randomBytes(5).toString('hex')}`
}

export interface HcCategory {
  /** TypeID, kb_category_... */
  id: string
  uuid: string
  slug: string
  name: string
  urlId: number
}

export interface HcArticle {
  /** TypeID, article_... */
  id: string
  uuid: string
  slug: string
  title: string
  urlId: number
  categoryId: string
  categorySlug: string
}

/** A category through REST (public unless `isPublic: false`). */
export async function hcCategory(
  api: APIRequestContext,
  name: string,
  opts: {
    parentId?: string | null
    isPublic?: boolean
    description?: string
    icon?: string
    position?: number
  } = {}
): Promise<HcCategory> {
  const res = await api.post('/api/v1/help-center/categories', { data: { name, ...opts } })
  const { data } = await expectJson<{ data: Wire }>(res, 201)
  const [row] =
    await supportDb()`SELECT id, url_id FROM kb_categories WHERE id = ${uuidOfTypeId(data.id)}`
  return {
    id: data.id as string,
    uuid: row.id as string,
    slug: data.slug as string,
    name: data.name as string,
    urlId: row.url_id as number,
  }
}

/** An article through REST; `publish: true` publishes it after the create. */
export async function hcArticle(
  api: APIRequestContext,
  input: {
    categoryId: string
    title: string
    content?: string
    description?: string
    slug?: string
    publish?: boolean
  }
): Promise<HcArticle> {
  const { publish, ...body } = input
  // API keys act as service principals, which need an explicit byline.
  const res = await api.post('/api/v1/help-center/articles', {
    data: { content: `Body of ${input.title}.`, authorId: adminPrincipalId(), ...body },
  })
  const { data } = await expectJson<{ data: Wire }>(res, 201)
  if (publish) {
    const pub = await api.patch(`/api/v1/help-center/articles/${data.id}`, {
      data: { publishedAt: new Date().toISOString() },
    })
    await expectJson(pub, 200)
  }
  const [row] =
    await supportDb()`SELECT id, url_id FROM kb_articles WHERE id = ${uuidOfTypeId(data.id)}`
  return {
    id: data.id as string,
    uuid: row.id as string,
    slug: data.slug as string,
    title: data.title as string,
    urlId: row.url_id as number,
    categoryId: data.category.id as string,
    categorySlug: data.category.slug as string,
  }
}

/** A category with one published article in it, both carrying `word`. */
export async function hcPublishedArticle(
  api: APIRequestContext,
  marker: string,
  opts: { word?: string; content?: string; isPublic?: boolean } = {}
): Promise<{ category: HcCategory; article: HcArticle; word: string }> {
  const word = opts.word ?? searchWord()
  const category = await hcCategory(api, `Guides ${marker}`, { isPublic: opts.isPublic })
  const article = await hcArticle(api, {
    categoryId: category.id,
    title: `Setting up the ${word} gadget`,
    content: opts.content ?? `Hold the ${word} button for five seconds. ${marker}`,
    publish: true,
  })
  return { category, article, word }
}

/** The canonical public article path, /hc/<locale>/articles/<urlId>-<slug>. */
export function articlePath(a: Pick<HcArticle, 'urlId' | 'slug'>, locale = 'en'): string {
  return `/hc/${locale}/articles/${a.urlId}-${a.slug}`
}

/** The canonical public collection path, /hc/<locale>/collections/<urlId>-<slug>. */
export function collectionPath(c: Pick<HcCategory, 'urlId' | 'slug'>, locale = 'en'): string {
  return `/hc/${locale}/collections/${c.urlId}-${c.slug}`
}

/** The admin editor deep link for an article. */
export function editorPath(a: Pick<HcArticle, 'id'>): string {
  return `/admin/help-center?article=${a.id}`
}

/** The uuid behind a TypeID (`article_...`, `kb_category_...`). */
export function uuidOfTypeId(typeId: string): string {
  return toUuid(typeId as Parameters<typeof toUuid>[0])
}

/** The stored article row (snake_case columns), or undefined. */
export async function articleRow(uuid: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await supportDb()`SELECT * FROM kb_articles WHERE id = ${uuid}`
  return row
}

/** The stored category row, or undefined. */
export async function categoryRow(uuid: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await supportDb()`SELECT * FROM kb_categories WHERE id = ${uuid}`
  return row
}

/**
 * A manual segment of this test's own (SQL), with `members` (principal
 * uuids) in it. Gates store the segment's TypeID.
 */
export async function hcSegment(
  marker: string,
  members: string[] = []
): Promise<{ id: string; uuid: string; name: string }> {
  const sql = supportDb()
  const uuid = toUuid(generateId('segment'))
  const name = `Segment ${marker} ${randomBytes(2).toString('hex')}`
  await sql`INSERT INTO segments (id, name, slug, type, created_at, updated_at)
    VALUES (${uuid}, ${name}, ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}, 'manual', NOW(), NOW())`
  for (const principalUuid of members) {
    await sql`INSERT INTO user_segments (principal_id, segment_id, added_by)
      VALUES (${principalUuid}, ${uuid}, 'manual')`
  }
  return { id: fromUuid('segment', uuid), uuid, name }
}

/** Gate a category or an article to segments (SQL; the admin UI is tested on its own). */
export async function gateToSegments(
  target: { kind: 'category' | 'article'; uuid: string },
  segmentIds: string[]
): Promise<void> {
  const json = JSON.stringify(segmentIds)
  if (target.kind === 'category') {
    await supportDb()`UPDATE kb_categories SET segment_ids = ${json}::jsonb WHERE id = ${target.uuid}`
  } else {
    await supportDb()`UPDATE kb_articles SET segment_ids = ${json}::jsonb WHERE id = ${target.uuid}`
  }
}

/** Fetch a public page as a signed-out visitor, bypassing the shared cache. */
export async function publicGet(
  request: APIRequestContext,
  path: string
): Promise<{ status: number; text: string }> {
  const res = await request.get(path, { maxRedirects: 0, headers: { 'cache-control': 'no-cache' } })
  return { status: res.status(), text: await res.text() }
}

export { expect }
