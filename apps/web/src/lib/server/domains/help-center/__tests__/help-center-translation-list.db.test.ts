/**
 * The admin list's languages against the real database (rolled back): each
 * article's state per language, and the "Needs update" and "Missing a
 * language" filters, which run inside the relational query builder.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type KbArticleId, type KbCategoryId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  helpCenterArticleTranslations,
  helpCenterArticles,
  helpCenterCategories,
  principal,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getHelpCenterConfig: async () => ({
    locales: { default: 'en', additional: ['de', 'fr'], chrome: {} },
  }),
}))

const { listArticles } = await import('../help-center.article.query')
const { listArticleLanguageSummaries } = await import('../help-center-translation-list')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ r: helpCenterArticles.textRevision }).from(helpCenterArticles).limit(0)
  },
})

let author: PrincipalId
let categoryId: KbCategoryId

async function seedArticle(title: string, textRevision = 1): Promise<KbArticleId> {
  const id = createId('kb_article') as KbArticleId
  await testDb.insert(helpCenterArticles).values({
    id,
    categoryId,
    slug: id,
    title,
    content: `${title} body`,
    principalId: author,
    textRevision,
  })
  return id
}

async function translate(
  articleId: KbArticleId,
  locale: string,
  opts: { status?: 'draft' | 'published'; sourceRevision?: number; pending?: boolean } = {}
) {
  await testDb.insert(helpCenterArticleTranslations).values({
    articleId,
    locale,
    title: `${locale} title`,
    content: 'x',
    status: opts.status ?? 'published',
    sourceRevision: opts.sourceRevision ?? 1,
    pendingTitle: opts.pending ? 'update' : null,
    pendingSourceRevision: opts.pending ? 2 : null,
  })
}

describe.skipIf(!fixture.available)('the article list in several languages', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb.update(helpCenterArticles).set({ deletedAt: new Date() })
    author = createId('principal') as PrincipalId
    await testDb.insert(principal).values({ id: author, createdAt: new Date() })
    categoryId = createId('kb_category') as KbCategoryId
    await testDb
      .insert(helpCenterCategories)
      .values({ id: categoryId, name: 'C', slug: categoryId })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('gives each article the state of each other language', async () => {
    const complete = await seedArticle('Complete')
    await translate(complete, 'de')
    await translate(complete, 'fr', { status: 'draft' })
    const behind = await seedArticle('Behind', 2)
    await translate(behind, 'de')
    await translate(behind, 'fr', { sourceRevision: 2, pending: true })

    const summaries = await listArticleLanguageSummaries(
      [
        { id: complete, locale: 'en', textRevision: 1 },
        { id: behind, locale: 'en', textRevision: 2 },
      ],
      ['en', 'de', 'fr']
    )
    expect(summaries.get(complete)).toEqual([
      { locale: 'de', state: 'published' },
      { locale: 'fr', state: 'draft' },
    ])
    expect(summaries.get(behind)).toEqual([
      { locale: 'de', state: 'needs_update' },
      { locale: 'fr', state: 'needs_update' },
    ])
  })

  it('filters to articles with a language that needs an update, or a language missing', async () => {
    const complete = await seedArticle('Complete')
    await translate(complete, 'de')
    await translate(complete, 'fr')
    const behind = await seedArticle('Behind', 2)
    await translate(behind, 'de')
    await translate(behind, 'fr', { sourceRevision: 2 })
    const waiting = await seedArticle('Waiting')
    await translate(waiting, 'de', { pending: true })
    await translate(waiting, 'fr')
    const missing = await seedArticle('Missing')
    await translate(missing, 'de')

    const needsUpdate = await listArticles({ languages: 'needs_update' })
    expect(needsUpdate.items.map((a) => a.id).sort()).toEqual([behind, waiting].sort())

    const missingOne = await listArticles({ languages: 'missing' })
    expect(missingOne.items.map((a) => a.id)).toEqual([missing])
  })
})
