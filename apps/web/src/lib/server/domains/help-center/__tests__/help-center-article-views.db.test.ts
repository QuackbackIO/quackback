/**
 * Article views and related articles on the public article page, against the
 * real database.
 *
 * A view is counted once, by the canonical article page, through
 * recordArticleView. Lookups by slug (legacy URLs that redirect to the
 * canonical page, embeds) no longer count, so a visit through an old link is
 * not counted twice.
 *
 * Related articles on a page in another language show the translated title
 * and link to that language when the article is translated there, and fall
 * back to the main language page otherwise (that page exists; the
 * untranslated one in the page's language does not).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type KbArticleId, type KbCategoryId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  helpCenterArticleTranslations,
  helpCenterArticles,
  helpCenterCategories,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../help-center-embedding.service', () => ({
  generateArticleEmbedding: async () => undefined,
}))
const viewLimit = vi.hoisted(() => ({ allow: true, calls: [] as unknown[][] }))
vi.mock('@/lib/server/utils/anon-rate-limit', () => ({
  reserveArticleView: async (...args: unknown[]) => {
    viewLimit.calls.push(args)
    return viewLimit.allow
  },
}))

import {
  countPublicArticleView,
  getPublicArticleBySlug,
  recordArticleView,
} from '../help-center.article.service'
import { localizeRelatedArticles } from '../help-center-locale.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: helpCenterArticles.id }).from(helpCenterArticles).limit(0)
  },
})

let author: PrincipalId
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  author = createId('principal') as PrincipalId
  await testDb.insert(principal).values({ id: author, createdAt: new Date() })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function seedCategory(isPublic = true): Promise<KbCategoryId> {
  const id = createId('kb_category') as KbCategoryId
  await testDb.insert(helpCenterCategories).values({ id, name: `Cat ${id}`, slug: id, isPublic })
  return id
}

async function seedArticle(
  categoryId: KbCategoryId,
  opts: { published?: boolean; title?: string } = {}
) {
  const id = createId('kb_article') as KbArticleId
  const [row] = await testDb
    .insert(helpCenterArticles)
    .values({
      id,
      categoryId,
      slug: id,
      title: opts.title ?? `Article ${id}`,
      content: 'Body',
      principalId: author,
      publishedAt: opts.published === false ? null : new Date(Date.now() - 60_000),
    })
    .returning()
  return row!
}

async function views(id: KbArticleId): Promise<number> {
  const [row] = await testDb
    .select({ viewCount: helpCenterArticles.viewCount })
    .from(helpCenterArticles)
    .where(eq(helpCenterArticles.id, id))
  return row!.viewCount
}

describe('a visitor viewing an article', () => {
  beforeEach(() => {
    viewLimit.allow = true
    viewLimit.calls = []
  })

  it('counts when the address has not viewed it in the last hour', async () => {
    const article = await seedArticle(await seedCategory())
    expect(await countPublicArticleView(article.id, '203.0.113.7')).toBe(true)
    expect(viewLimit.calls).toEqual([['203.0.113.7', article.id]])
    expect(await views(article.id)).toBe(1)
  })

  it('does not count a repeat view or a rate-limited address', async () => {
    const article = await seedArticle(await seedCategory())
    viewLimit.allow = false
    expect(await countPublicArticleView(article.id, '203.0.113.7')).toBe(false)
    expect(await views(article.id)).toBe(0)
  })

  it('ignores a reference that is not an article id, spending no budget', async () => {
    expect(await countPublicArticleView('not-an-id', '203.0.113.7')).toBe(false)
    expect(viewLimit.calls).toEqual([])
  })
})

describe('article views', () => {
  it('counts one view of a published public article', async () => {
    const article = await seedArticle(await seedCategory())
    await recordArticleView(article.id)
    expect(await views(article.id)).toBe(1)
  })

  it('does not count a draft or an article in a private category', async () => {
    const draft = await seedArticle(await seedCategory(), { published: false })
    const hidden = await seedArticle(await seedCategory(false))
    await recordArticleView(draft.id)
    await recordArticleView(hidden.id)
    expect(await views(draft.id)).toBe(0)
    expect(await views(hidden.id)).toBe(0)
  })

  it('a lookup by slug does not count, so a redirected visit counts once', async () => {
    const article = await seedArticle(await seedCategory())
    await getPublicArticleBySlug(article.slug)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await views(article.id)).toBe(0)
  })
})

describe('related articles in another language', () => {
  it('uses the translation when there is one and the main language page when not', async () => {
    const categoryId = await seedCategory()
    const translated = await seedArticle(categoryId, { title: 'Router guide' })
    const untranslated = await seedArticle(categoryId, { title: 'Router advanced' })
    const drafted = await seedArticle(categoryId, { title: 'Router reset' })
    await testDb.insert(helpCenterArticleTranslations).values([
      {
        articleId: translated.id,
        locale: 'fr',
        title: 'Guide du routeur',
        content: 'Texte',
        status: 'published',
      },
      {
        articleId: drafted.id,
        locale: 'fr',
        title: 'Brouillon',
        content: 'Texte',
        status: 'draft',
      },
    ])
    const related = [translated, untranslated, drafted].map((a) => ({
      id: a.id,
      urlId: a.urlId,
      slug: a.slug,
      title: a.title,
      description: null,
      categorySlug: categoryId,
    }))

    const localized = await localizeRelatedArticles(related, 'fr')

    expect(localized.map((a) => [a.title, a.locale])).toEqual([
      ['Guide du routeur', 'fr'],
      ['Router advanced', 'en'],
      ['Router reset', 'en'],
    ])
  })

  it('leaves main language related articles as they are', async () => {
    const article = await seedArticle(await seedCategory(), { title: 'Router guide' })
    const related = [
      {
        id: article.id,
        urlId: article.urlId,
        slug: article.slug,
        title: article.title,
        description: null,
        categorySlug: 'c',
      },
    ]
    expect(await localizeRelatedArticles(related, 'en')).toEqual([{ ...related[0], locale: 'en' }])
  })
})
