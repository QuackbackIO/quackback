/**
 * Help center reads in one language, against the real database. A reader
 * always gets an answer: an article or collection with no version in the
 * page's language reads in the language its own text is in, and says which.
 * The sitemap lists only real versions.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type KbArticleId, type KbCategoryId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  helpCenterArticleTranslations,
  helpCenterArticles,
  helpCenterCategories,
  helpCenterCategoryTranslations,
  principal,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const {
  listPublicCategoriesWithFallback,
  listPublicCategoriesWithVersionIn,
  listPublicArticlesForCategoryWithFallback,
  articlesWithVersionIn,
  listPublicArticlesForCategoriesWithFallback,
  getPublicArticleBySlugForLocale,
  getPublicCategoryBySlugForLocale,
  localizeRelatedArticles,
} = await import('../help-center-locale.query')
const { listPublicArticles } = await import('../help-center.article.query')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ locale: helpCenterCategories.locale }).from(helpCenterCategories).limit(0)
  },
})

let author: PrincipalId

async function seedCategory(name: string, locale = 'en'): Promise<KbCategoryId> {
  const id = createId('kb_category') as KbCategoryId
  await testDb.insert(helpCenterCategories).values({ id, name, slug: id, locale })
  return id
}

async function seedArticle(
  categoryId: KbCategoryId,
  title: string,
  opts: { locale?: string; content?: string } = {}
) {
  const id = createId('kb_article') as KbArticleId
  const [row] = await testDb
    .insert(helpCenterArticles)
    .values({
      id,
      categoryId,
      slug: id,
      title,
      content: opts.content ?? `${title} body`,
      principalId: author,
      locale: opts.locale ?? 'en',
      publishedAt: new Date(Date.now() - 60_000),
    })
    .returning()
  return row!
}

async function translateArticle(
  articleId: KbArticleId,
  locale: string,
  title: string,
  status: 'draft' | 'published' = 'published',
  content = `${title} body`
) {
  await testDb
    .insert(helpCenterArticleTranslations)
    .values({ articleId, locale, title, content, status })
}

async function translateCategory(categoryId: KbCategoryId, locale: string, name: string) {
  await testDb.insert(helpCenterCategoryTranslations).values({ categoryId, locale, name })
}

describe.skipIf(!fixture.available)('help center reads in one language', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb.update(helpCenterArticles).set({ deletedAt: new Date() })
    await testDb.update(helpCenterCategories).set({ deletedAt: new Date() })
    author = createId('principal') as PrincipalId
    await testDb.insert(principal).values({ id: author, createdAt: new Date() })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lists every collection, translated ones in the language and the rest in their own', async () => {
    const billing = await seedCategory('Billing')
    const account = await seedCategory('Account')
    await translateCategory(billing, 'fr', 'Facturation')
    await translateCategory(account, 'fr', '   ')
    await seedArticle(billing, 'Invoices')
    await seedArticle(account, 'Password')

    const listed = await listPublicCategoriesWithFallback('fr')

    expect(listed.map((c) => [c.name, c.locale]).sort()).toEqual([
      ['Account', 'en'],
      ['Facturation', 'fr'],
    ])
  })

  it('lists every article, translated ones in the language and the rest in their own, drafts not counting', async () => {
    const cat = await seedCategory('Billing')
    const invoices = await seedArticle(cat, 'Invoices')
    const refunds = await seedArticle(cat, 'Refunds')
    const receipts = await seedArticle(cat, 'Receipts')
    await translateArticle(invoices.id, 'fr', 'Factures')
    await translateArticle(refunds.id, 'fr', 'Remboursements', 'draft')

    const listed = await listPublicArticlesForCategoryWithFallback(cat, 'fr')
    const batched = await listPublicArticlesForCategoriesWithFallback([cat], 'fr')

    const expected = [
      ['Factures', 'fr'],
      ['Receipts', 'en'],
      ['Refunds', 'en'],
    ]
    expect(listed.map((a) => [a.title, a.locale]).sort()).toEqual(expected)
    expect((batched.get(cat) ?? []).map((a) => [a.title, a.locale]).sort()).toEqual(expected)
    expect(receipts.locale).toBe('en')
  })

  it('opens an article with no version in the language in its own, instead of not finding it', async () => {
    const cat = await seedCategory('Billing')
    const invoices = await seedArticle(cat, 'Invoices')
    const refunds = await seedArticle(cat, 'Refunds')
    await translateArticle(refunds.id, 'fr', 'Remboursements', 'draft')

    const untranslated = await getPublicArticleBySlugForLocale(invoices.slug, 'fr')
    const drafted = await getPublicArticleBySlugForLocale(refunds.slug, 'fr')

    expect([untranslated.title, untranslated.locale]).toEqual(['Invoices', 'en'])
    expect([drafted.title, drafted.locale]).toEqual(['Refunds', 'en'])
  })

  it('reads a published translation with its own body, built from Markdown when it has no rich body', async () => {
    const cat = await seedCategory('Billing')
    const invoices = await seedArticle(cat, 'Invoices', { content: 'English body' })
    await translateArticle(invoices.id, 'fr', 'Factures', 'published', 'Corps **français**')

    const article = await getPublicArticleBySlugForLocale(invoices.slug, 'fr')

    expect([article.title, article.locale, article.content]).toEqual([
      'Factures',
      'fr',
      'Corps **français**',
    ])
    expect(JSON.stringify(article.contentJson)).toContain('français')
    expect(JSON.stringify(article.contentJson)).not.toContain('English body')
  })

  it("reads an article's own text in its own language, even where the main language is another", async () => {
    // An article left in English when the main language became German, with
    // a stale German draft: German readers get the English text, and English
    // readers get it as it is.
    const cat = await seedCategory('Konto', 'de')
    const kept = await seedArticle(cat, 'Invoices', { locale: 'en' })
    await translateArticle(kept.id, 'de', 'Rechnungen', 'draft')
    const german = await seedArticle(cat, 'Passwort', { locale: 'de' })
    await translateArticle(german.id, 'en', 'Password')

    expect((await getPublicArticleBySlugForLocale(kept.slug, 'de')).locale).toBe('en')
    expect((await getPublicArticleBySlugForLocale(kept.slug, 'en')).title).toBe('Invoices')
    expect((await getPublicArticleBySlugForLocale(german.slug, 'de')).title).toBe('Passwort')
    expect((await getPublicArticleBySlugForLocale(german.slug, 'en')).title).toBe('Password')
  })

  it('opens a collection with no name in the language in its own', async () => {
    const cat = await seedCategory('Billing')
    await seedArticle(cat, 'Invoices')

    const category = await getPublicCategoryBySlugForLocale(cat, 'fr')

    expect([category.name, category.locale]).toEqual(['Billing', 'en'])
  })

  it('names related articles in the language where they have a version there', async () => {
    const cat = await seedCategory('Billing')
    const invoices = await seedArticle(cat, 'Invoices')
    const refunds = await seedArticle(cat, 'Refunds')
    await translateArticle(invoices.id, 'fr', 'Factures')
    const related = [invoices, refunds].map((a) => ({
      id: a.id,
      urlId: a.urlId,
      slug: a.slug,
      title: a.title,
      description: null,
      locale: a.locale,
      categorySlug: cat,
    }))

    const localized = await localizeRelatedArticles(related, 'fr')

    expect(localized.map((a) => [a.title, a.locale])).toEqual([
      ['Factures', 'fr'],
      ['Refunds', 'en'],
    ])
  })

  describe('for the sitemap', () => {
    const languages = { main: 'en', additional: ['fr', 'de'] }
    const publicArticles = async () =>
      (await listPublicArticles({ limit: 50000 })).items.sort((a, b) =>
        a.title.localeCompare(b.title)
      )

    it('lists only articles with a real version in the language', async () => {
      const cat = await seedCategory('Billing')
      const invoices = await seedArticle(cat, 'Invoices')
      const refunds = await seedArticle(cat, 'Refunds')
      await seedArticle(cat, 'Receipts')
      await translateArticle(invoices.id, 'fr', 'Factures')
      await translateArticle(refunds.id, 'fr', 'Remboursements', 'draft')

      const listed = await articlesWithVersionIn(await publicArticles(), 'fr', languages)

      expect(listed.map((a) => a.title)).toEqual(['Invoices'])
    })

    it('lists a collection only with a version in the language and an article that has one', async () => {
      const named = await seedCategory('Billing')
      const unnamed = await seedCategory('Account')
      const empty = await seedCategory('Shipping')
      await translateCategory(named, 'fr', 'Facturation')
      await translateCategory(empty, 'fr', 'Livraison')
      const invoices = await seedArticle(named, 'Invoices')
      const password = await seedArticle(unnamed, 'Password')
      await seedArticle(empty, 'Tracking')
      await translateArticle(invoices.id, 'fr', 'Factures')
      await translateArticle(password.id, 'fr', 'Mot de passe')

      const listed = await listPublicCategoriesWithVersionIn('fr', languages)

      expect(listed.map((c) => c.name)).toEqual(['Facturation'])
    })

    it("counts an article's own text as a version in its own language", async () => {
      const cat = await seedCategory('Konto', 'de')
      await seedArticle(cat, 'Passwort', { locale: 'de' })
      await seedArticle(cat, 'Invoices', { locale: 'en' })

      expect((await listPublicCategoriesWithVersionIn('de', languages)).map((c) => c.name)).toEqual(
        ['Konto']
      )
      expect(
        (await articlesWithVersionIn(await publicArticles(), 'de', languages)).map((a) => a.title)
      ).toEqual(['Passwort'])
      expect(await listPublicCategoriesWithVersionIn('en', languages)).toEqual([])
    })

    it('lists a main-language parent collection for the main language when its articles sit in a subcollection', async () => {
      const guides = await seedCategory('Guides')
      const setup = await testDb
        .insert(helpCenterCategories)
        .values({
          id: createId('kb_category') as KbCategoryId,
          name: 'Setup',
          slug: 'setup',
          parentId: guides,
        })
        .returning()
      await seedArticle(setup[0]!.id as KbCategoryId, 'Install')

      const listed = await listPublicCategoriesWithVersionIn('en', languages)

      expect(listed.map((c) => c.name).sort()).toEqual(['Guides', 'Setup'])
    })

    it('lists under the main language the items written in a language the help center does not offer', async () => {
      const cat = await seedCategory('Cuenta', 'es')
      await seedArticle(cat, 'Contraseña', { locale: 'es' })

      expect((await listPublicCategoriesWithVersionIn('en', languages)).map((c) => c.name)).toEqual(
        ['Cuenta']
      )
      expect(
        (await articlesWithVersionIn(await publicArticles(), 'en', languages)).map((a) => a.title)
      ).toEqual(['Contraseña'])
      expect(await listPublicCategoriesWithVersionIn('fr', languages)).toEqual([])
    })
  })
})
