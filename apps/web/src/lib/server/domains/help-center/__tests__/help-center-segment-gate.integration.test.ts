/**
 * Execution-level tests for help-center category segment gating: for every
 * public read path (search, ranked search, listing, by-slug, assistant
 * retrieval, and the viewer-less sitemap defaults), an article/category under
 * a segment-gated category must be invisible to anonymous viewers and
 * non-members, and visible to segment members and team actors.
 *
 * Runs the real service functions against the real database: the global `db`
 * proxy is pre-seeded with this file's own short-lived connection (closed in
 * afterAll) so the services under test execute their actual SQL — including
 * segmentGateFilter's jsonb rendering — rather than mocks. Embedding
 * generation is mocked to null so search/retrieval deterministically take the
 * keyword path (no network, no model config dependency).
 *
 * Connects via DATABASE_URL (vitest pins quackback_test), falling back to the
 * dev DB; skips gracefully when neither is reachable — same pattern as
 * board-view-filter-parity.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { sql } from 'drizzle-orm'

vi.mock('../help-center-embedding.service', () => ({
  generateKbQueryEmbedding: vi.fn().mockResolvedValue(null),
  generateKbEmbedding: vi.fn().mockResolvedValue(null),
  generateArticleEmbedding: vi.fn().mockResolvedValue(true),
  clearQueryEmbeddingCache: vi.fn(),
  formatArticleText: (title: string) => title,
}))

import {
  helpCenterArticles,
  helpCenterCategories,
  principal,
  type Database,
} from '@/lib/server/db'
// eslint-disable-next-line no-restricted-imports -- legitimate createDb caller: this file owns the global db for its worker (see board-view-filter-parity.test.ts)
import { createDb } from '@quackback/db/client'
import { createId, type KbArticleId, type KbCategoryId, type PrincipalId, type SegmentId } from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { NotFoundError } from '@/lib/shared/errors'
import { hybridSearch, searchArticleIdsRanked } from '../help-center-search.service'
import {
  listPublicArticles,
  listPublicArticlesForCategory,
  listPopularPublicArticles,
} from '../help-center.article.query'
import { getPublicArticleBySlug } from '../help-center.article.service'
import { listPublicCategories, getPublicCategoryBySlug } from '../help-center.category.service'
import { getPublicArticleBySlugForLocale } from '../help-center-locale.query'
import { retrieveKbArticles } from '@/lib/server/domains/assistant/retrieval'

const SEG_ALPHA = createId('segment') as SegmentId
const SEG_BETA = createId('segment') as SegmentId
const P_AUTHOR = createId('principal') as PrincipalId

const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
// Unique searchable token: appears in every seeded title so one query ranks
// them all, and never appears in unrelated rows in a shared test DB.
const TOKEN = `quokka${runSuffix.replace(/[^a-z0-9]/gi, '')}`

function userActor(segmentIds: SegmentId[]): Actor {
  return {
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(segmentIds),
  }
}

const member = userActor([SEG_ALPHA])
const outsider = userActor([SEG_BETA])
const team: Actor = {
  principalId: createId('principal') as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const db = createDb(url, { max: 4, prepare: false })
      await db.execute(sql`select 1`)
      await db.execute(sql`select id, segment_ids from ${helpCenterCategories} limit 0`)
      return {
        db,
        close: async () => {
          const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
          await raw?.end?.()
        },
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

let activeDb: Database | null = null
let closeDb: (() => Promise<void>) | null = null

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
  // Point the app's global db singleton at this file's connection so the
  // service functions under test run real SQL and the pool can be closed.
  ;(globalThis as Record<string, unknown>).__db = resolved.db
}

interface SeededCategory {
  id: KbCategoryId
  slug: string
}

let catOpen: SeededCategory
let catGated: SeededCategory
let catPrivate: SeededCategory
let artOpenSlug: string
let artGatedSlug: string
let artPrivateSlug: string
const articleIds: KbArticleId[] = []

async function seedCategory(name: string, isPublic: boolean, segmentIds: string[]) {
  const id = createId('kb_category') as KbCategoryId
  const slug = `sg-${runSuffix}-${name}`
  await activeDb!.insert(helpCenterCategories).values({
    id,
    slug,
    name: `sg:${name}`,
    isPublic,
    segmentIds,
  })
  return { id, slug }
}

async function seedArticle(name: string, categoryId: KbCategoryId) {
  const id = createId('kb_article') as KbArticleId
  const slug = `sg-${runSuffix}-${name}`
  await activeDb!.insert(helpCenterArticles).values({
    id,
    categoryId,
    slug,
    title: `${TOKEN} ${name} guide`,
    content: `How to use the ${TOKEN} feature (${name}).`,
    principalId: P_AUTHOR,
    publishedAt: new Date(Date.now() - 60_000),
  })
  articleIds.push(id)
  return slug
}

/** Restrict a result list to this run's rows and project slugs, order-insensitive. */
function ownSlugs(rows: Array<{ slug: string }>): string[] {
  return rows
    .map((r) => r.slug)
    .filter((s) => s.startsWith(`sg-${runSuffix}-`))
    .sort()
}

describe.skipIf(!dbAvailable)('help-center segment gate (execution-level)', () => {
  beforeAll(async () => {
    if (!activeDb) return
    // Pre-sweep leftovers from crashed prior runs (articles cascade from
    // categories via FK, but delete both to be thorough).
    await activeDb.delete(helpCenterArticles).where(sql`${helpCenterArticles.slug} ~ '^sg-[0-9]+-'`)
    await activeDb
      .delete(helpCenterCategories)
      .where(sql`${helpCenterCategories.slug} ~ '^sg-[0-9]+-'`)
    await activeDb
      .insert(principal)
      .values({ id: P_AUTHOR, createdAt: new Date() })
      .onConflictDoNothing()

    catOpen = await seedCategory('open', true, [])
    catGated = await seedCategory('gated', true, [SEG_ALPHA])
    catPrivate = await seedCategory('private', false, [])
    artOpenSlug = await seedArticle('open-article', catOpen.id)
    artGatedSlug = await seedArticle('gated-article', catGated.id)
    artPrivateSlug = await seedArticle('private-article', catPrivate.id)
  })

  afterAll(async () => {
    if (activeDb) {
      await activeDb
        .delete(helpCenterCategories)
        .where(sql`${helpCenterCategories.slug} LIKE ${`sg-${runSuffix}-%`}`)
      await activeDb
        .delete(helpCenterArticles)
        .where(sql`${helpCenterArticles.slug} LIKE ${`sg-${runSuffix}-%`}`)
    }
    delete (globalThis as Record<string, unknown>).__db
    await closeDb?.()
  })

  // ---- Path 1: search --------------------------------------------------

  it('search: gated article invisible to anonymous and non-members, visible to member and team', async () => {
    expect(ownSlugs(await hybridSearch(TOKEN, 10))).toEqual([artOpenSlug])
    expect(ownSlugs(await hybridSearch(TOKEN, 10, outsider))).toEqual([artOpenSlug])
    expect(ownSlugs(await hybridSearch(TOKEN, 10, member)).sort()).toEqual(
      [artOpenSlug, artGatedSlug].sort()
    )
    expect(ownSlugs(await hybridSearch(TOKEN, 10, team)).sort()).toEqual(
      [artOpenSlug, artGatedSlug].sort()
    )
  })

  it('ranked search: public audience gates in SQL; team audience sees drafts/private/gated', async () => {
    const publicAnon = await searchArticleIdsRanked(TOKEN, { audience: 'public' })
    const publicMember = await searchArticleIdsRanked(TOKEN, { audience: 'public', viewer: member })
    const teamPool = await searchArticleIdsRanked(TOKEN, { audience: 'team' })

    const own = (ids: string[]) => ids.filter((id) => articleIds.includes(id as KbArticleId))
    expect(own(publicAnon)).toHaveLength(1)
    expect(own(publicMember)).toHaveLength(2)
    // Team bypass: open + gated + private-category article all rank.
    expect(own(teamPool)).toHaveLength(3)
  })

  // ---- Path 2: listing ---------------------------------------------------

  it('listPublicArticles: gated and private-category articles excluded for anonymous, gated included for member', async () => {
    const anon = await listPublicArticles({ limit: 100 })
    expect(ownSlugs(anon.items)).toEqual([artOpenSlug])

    const forMember = await listPublicArticles({ limit: 100 }, member)
    expect(ownSlugs(forMember.items).sort()).toEqual([artOpenSlug, artGatedSlug].sort())

    const forTeamViewer = await listPublicArticles({ limit: 100 }, team)
    expect(ownSlugs(forTeamViewer.items)).toContain(artGatedSlug)
    // Private (isPublic=false) categories stay team-only via the admin
    // surface; the PUBLIC listing never includes them, even for team viewers
    // browsing the public site with the gate bypassed.
    expect(ownSlugs(forTeamViewer.items)).not.toContain(artPrivateSlug)
  })

  it('listPublicArticlesForCategory: a gated category returns no articles to non-members', async () => {
    expect(ownSlugs(await listPublicArticlesForCategory(catGated.id))).toEqual([])
    expect(ownSlugs(await listPublicArticlesForCategory(catGated.id, outsider))).toEqual([])
    expect(ownSlugs(await listPublicArticlesForCategory(catGated.id, member))).toEqual([
      artGatedSlug,
    ])
    expect(ownSlugs(await listPublicArticlesForCategory(catGated.id, team))).toEqual([artGatedSlug])
  })

  it('listPublicCategories: gated category hidden from anonymous and non-members', async () => {
    const own = (rows: Array<{ slug: string }>) => ownSlugs(rows)
    expect(own(await listPublicCategories())).toEqual([catOpen.slug])
    expect(own(await listPublicCategories(outsider))).toEqual([catOpen.slug])
    expect(own(await listPublicCategories(member)).sort()).toEqual(
      [catOpen.slug, catGated.slug].sort()
    )
    expect(own(await listPublicCategories(team)).sort()).toEqual(
      [catOpen.slug, catGated.slug].sort()
    )
  })

  it('listPopularPublicArticles: gated articles excluded for anonymous, included for member', async () => {
    expect(ownSlugs(await listPopularPublicArticles(500))).toEqual([artOpenSlug])
    expect(ownSlugs(await listPopularPublicArticles(500, member)).sort()).toEqual(
      [artOpenSlug, artGatedSlug].sort()
    )
  })

  // ---- Path 3: by-slug -----------------------------------------------------

  it('getPublicArticleBySlug: gated article 404s identically to a missing one for non-members', async () => {
    await expect(getPublicArticleBySlug(artGatedSlug)).rejects.toThrow(NotFoundError)
    await expect(getPublicArticleBySlug(artGatedSlug, outsider)).rejects.toThrow(NotFoundError)
    await expect(getPublicArticleBySlug(artGatedSlug, member)).resolves.toMatchObject({
      slug: artGatedSlug,
    })
    await expect(getPublicArticleBySlug(artGatedSlug, team)).resolves.toMatchObject({
      slug: artGatedSlug,
    })
    // Private categories are unchanged: team-only regardless of segments.
    await expect(getPublicArticleBySlug(artPrivateSlug, member)).rejects.toThrow(NotFoundError)
  })

  it('getPublicCategoryBySlug: gated category 404s for non-members, resolves for member and team', async () => {
    await expect(getPublicCategoryBySlug(catGated.slug)).rejects.toThrow(NotFoundError)
    await expect(getPublicCategoryBySlug(catGated.slug, outsider)).rejects.toThrow(NotFoundError)
    await expect(getPublicCategoryBySlug(catGated.slug, member)).resolves.toMatchObject({
      slug: catGated.slug,
    })
    await expect(getPublicCategoryBySlug(catGated.slug, team)).resolves.toMatchObject({
      slug: catGated.slug,
    })
    await expect(getPublicCategoryBySlug(catPrivate.slug, member)).rejects.toThrow(NotFoundError)
  })

  it('locale by-slug wrapper inherits the gate (default locale delegates to the base lookup)', async () => {
    await expect(getPublicArticleBySlugForLocale(artGatedSlug, 'en')).rejects.toThrow(NotFoundError)
    await expect(
      getPublicArticleBySlugForLocale(artGatedSlug, 'en', member)
    ).resolves.toMatchObject({ slug: artGatedSlug })
  })

  // ---- Path 4: sitemap (viewer-less defaults) ------------------------------

  it('sitemap semantics: the viewer-less defaults expose only ungated content', async () => {
    // The sitemap route calls listPublicCategories/listPublicArticles with no
    // viewer — proven above to fail closed (ANONYMOUS_ACTOR default). Pin the
    // default explicitly so a future "default viewer" change can't silently
    // start advertising gated slugs to crawlers.
    const categories = await listPublicCategories()
    const articles = await listPublicArticles({ limit: 100 })
    expect(ownSlugs(categories)).toEqual([catOpen.slug])
    expect(ownSlugs(articles.items)).toEqual([artOpenSlug])
  })

  // ---- Path 5: assistant retrieval -----------------------------------------

  it('retrieval: public audience excludes gated articles unless the viewer is a member', async () => {
    const own = (rows: Array<{ slug: string }>) => ownSlugs(rows)
    expect(own(await retrieveKbArticles(TOKEN, { audience: 'public', topK: 10 }))).toEqual([
      artOpenSlug,
    ])
    expect(
      own(await retrieveKbArticles(TOKEN, { audience: 'public', viewer: outsider, topK: 10 }))
    ).toEqual([artOpenSlug])
    expect(
      own(await retrieveKbArticles(TOKEN, { audience: 'public', viewer: member, topK: 10 })).sort()
    ).toEqual([artOpenSlug, artGatedSlug].sort())
  })

  it('retrieval: team audience sees gated articles but flags them internal (isPublic=false)', async () => {
    const rows = (await retrieveKbArticles(TOKEN, { audience: 'team', topK: 10 })).filter((r) =>
      r.slug.startsWith(`sg-${runSuffix}-`)
    )
    const bySlug = new Map(rows.map((r) => [r.slug, r]))
    expect(bySlug.get(artOpenSlug)?.isPublic).toBe(true)
    // Segment-gated => not public-to-everyone => internal for the leak gate.
    expect(bySlug.get(artGatedSlug)?.isPublic).toBe(false)
    expect(bySlug.get(artPrivateSlug)?.isPublic).toBe(false)
  })

  // ---- Anonymous default (safety rule) --------------------------------------

  it('every entry point defaults to the anonymous viewer (fail closed)', async () => {
    // Spot-check: calling with the explicit ANONYMOUS_ACTOR equals calling
    // with no viewer at all.
    expect(ownSlugs(await hybridSearch(TOKEN, 10, ANONYMOUS_ACTOR))).toEqual(
      ownSlugs(await hybridSearch(TOKEN, 10))
    )
  })
})
