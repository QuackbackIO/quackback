/**
 * Changing the main language moves the help center's content, against the
 * real database (rolled back). Each article and collection with a version in
 * the new language swaps to it, offered or not; the rest of the old main
 * language is relabelled when the help center does not offer the new one, and
 * otherwise stays in its own language. A published article never takes a
 * draft as its text, and nothing is deleted.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  toUuid,
  type KbArticleId,
  type KbCategoryId,
  type PrincipalId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  helpCenterArticleTranslations,
  helpCenterArticles,
  helpCenterCategories,
  helpCenterCategoryTranslations,
  principal,
  settings,
  sql,
} from '@/lib/server/db'
import type { HelpCenterConfig } from '@/lib/server/domains/settings/settings.types'
import { DEFAULT_HELP_CENTER_CONFIG } from '@/lib/server/domains/settings/settings.types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const embedded = vi.hoisted(() => ({ ids: [] as string[] }))
vi.mock('../help-center-embedding.service', () => ({
  generateArticleEmbedding: async (id: string) => {
    embedded.ids.push(id)
    return true
  },
}))

const { updateLanguageConfig, getHelpCenterConfig } =
  await import('@/lib/server/domains/settings/settings.service')
const { previewHelpCenterMainLanguage, helpCenterConfigForMainLanguage } =
  await import('../help-center-main-language.service')
const { hybridSearchForLocale } = await import('../help-center-search.service')
const { extraHelpCenterLocales } = await import('../../plan-limits/plan-limits.locales')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ locale: helpCenterCategories.locale }).from(helpCenterCategories).limit(0)
  },
})

let author: PrincipalId
const HOUR = 60 * 60 * 1000
const ARTICLE_WRITTEN = new Date(Date.now() - 48 * HOUR)
const TRANSLATION_WRITTEN = new Date(Date.now() - 24 * HOUR)

async function storeHelpCenter(config: Partial<HelpCenterConfig>) {
  const values = {
    languageConfig: null,
    helpCenterConfig: JSON.stringify({ ...DEFAULT_HELP_CENTER_CONFIG, ...config }),
  }
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (row) await testDb.update(settings).set(values)
  else
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date(), ...values })
}

const locales = (
  def: string,
  additional: string[],
  chrome: HelpCenterConfig['locales']['chrome'] = {}
) => ({
  locales: { default: def, additional, chrome },
})

async function seedCategory(name: string, locale = 'en'): Promise<KbCategoryId> {
  const id = createId('kb_category') as KbCategoryId
  await testDb.insert(helpCenterCategories).values({
    id,
    name,
    description: `${name} description`,
    slug: id,
    locale,
    updatedAt: ARTICLE_WRITTEN,
  })
  return id
}

async function seedArticle(
  categoryId: KbCategoryId,
  title: string,
  opts: { published?: boolean; locale?: string; deleted?: boolean } = {}
): Promise<KbArticleId> {
  const id = createId('kb_article') as KbArticleId
  await testDb.insert(helpCenterArticles).values({
    id,
    categoryId,
    slug: id,
    title,
    description: `${title} summary`,
    content: `${title} body`,
    contentJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `${title} body` }] }],
    },
    principalId: author,
    locale: opts.locale ?? 'en',
    publishedAt: opts.published === false ? null : new Date(Date.now() - 72 * HOUR),
    deletedAt: opts.deleted ? new Date() : null,
    updatedAt: ARTICLE_WRITTEN,
  })
  return id
}

async function translate(
  articleId: KbArticleId,
  locale: string,
  title: string,
  opts: { status?: 'draft' | 'published'; richBody?: boolean } = {}
) {
  await testDb.insert(helpCenterArticleTranslations).values({
    articleId,
    locale,
    title,
    description: title ? `${title} Zusammenfassung` : null,
    content: `${title} **Text**`,
    contentJson:
      opts.richBody === false
        ? null
        : {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `${title} Text` }] }],
          },
    status: opts.status ?? 'published',
    updatedAt: TRANSLATION_WRITTEN,
  })
}

async function article(id: KbArticleId) {
  const [row] = await testDb.select().from(helpCenterArticles).where(eq(helpCenterArticles.id, id))
  return row!
}

async function translationsOf(id: KbArticleId) {
  const rows = await testDb
    .select()
    .from(helpCenterArticleTranslations)
    .where(eq(helpCenterArticleTranslations.articleId, id))
  return Object.fromEntries(rows.map((r) => [r.locale, r]))
}

async function category(id: KbCategoryId) {
  const [row] = await testDb
    .select()
    .from(helpCenterCategories)
    .where(eq(helpCenterCategories.id, id))
  const translations = await testDb
    .select()
    .from(helpCenterCategoryTranslations)
    .where(eq(helpCenterCategoryTranslations.categoryId, id))
  return { ...row!, translations: Object.fromEntries(translations.map((t) => [t.locale, t])) }
}

describe.skipIf(!fixture.available)('changing the main language', () => {
  beforeEach(async () => {
    await fixture.begin()
    embedded.ids = []
    await testDb.update(helpCenterArticles).set({ deletedAt: new Date() })
    await testDb.update(helpCenterCategories).set({ deletedAt: new Date() })
    author = createId('principal') as PrincipalId
    await testDb.insert(principal).values({ id: author, createdAt: new Date() })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('to a language the help center does not offer', () => {
    it('relabels only what is in the old main language, and rewrites nothing', async () => {
      await storeHelpCenter(locales('en', []))
      const cat = await seedCategory('Erste Schritte')
      const french = await seedCategory('Facturation', 'fr')
      const main = await seedArticle(cat, 'Einstellungen')
      const kept = await seedArticle(cat, 'Factures', { locale: 'fr' })

      await updateLanguageConfig({ mainLanguage: 'de' })

      expect(await article(main)).toMatchObject({ locale: 'de', title: 'Einstellungen' })
      expect((await article(kept)).locale).toBe('fr')
      expect((await category(cat)).locale).toBe('de')
      expect((await category(french)).locale).toBe('fr')
      expect(embedded.ids).toEqual([])
    })

    it('swaps in the versions a removed extra language kept, instead of hiding them under relabelled text', async () => {
      await storeHelpCenter(locales('en', []))
      const cat = await seedCategory('Account')
      await testDb
        .insert(helpCenterCategoryTranslations)
        .values({ categoryId: cat, locale: 'de', name: 'Konto' })
      const translated = await seedArticle(cat, 'Change your password')
      await translate(translated, 'de', 'Passwort ändern')
      const untranslated = await seedArticle(cat, 'Billing')

      await updateLanguageConfig({ mainLanguage: 'de' })

      expect(await article(translated)).toMatchObject({ locale: 'de', title: 'Passwort ändern' })
      const translations = await translationsOf(translated)
      expect(Object.keys(translations)).toEqual(['en'])
      expect(translations.en.title).toBe('Change your password')
      expect(await article(untranslated)).toMatchObject({ locale: 'de', title: 'Billing' })
      expect(await category(cat)).toMatchObject({ locale: 'de', name: 'Konto' })
      await vi.waitFor(() => expect(embedded.ids).toEqual([translated]))
    })

    it('keeps a published article with only a draft in the new language as it is, and the draft stays a draft', async () => {
      await storeHelpCenter(locales('en', []))
      const cat = await seedCategory('Account')
      const id = await seedArticle(cat, 'Change your password')
      await translate(id, 'de', 'Passwort ändern', { status: 'draft' })

      await updateLanguageConfig({ mainLanguage: 'de' })

      expect(await article(id)).toMatchObject({ locale: 'en', title: 'Change your password' })
      expect((await translationsOf(id)).de).toMatchObject({
        title: 'Passwort ändern',
        status: 'draft',
      })
    })

    it('loses no text when a removed language becomes the main language and an extra one follows', async () => {
      await storeHelpCenter(locales('en', ['fr']))
      const cat = await seedCategory('Account')
      const id = await seedArticle(cat, 'Change your password')
      await translate(id, 'de', 'Passwort ändern')
      await translate(id, 'fr', 'Changer le mot de passe')

      await updateLanguageConfig({ mainLanguage: 'de' })
      await updateLanguageConfig({ mainLanguage: 'fr' })

      expect(await article(id)).toMatchObject({ locale: 'fr', title: 'Changer le mot de passe' })
      const translations = await translationsOf(id)
      expect(
        Object.fromEntries(Object.entries(translations).map(([l, t]) => [l, t.title]))
      ).toEqual({ de: 'Passwort ändern', en: 'Change your password' })
    })

    it("takes a removed language's homepage words as the main ones, keeping the old ones for its return", async () => {
      await storeHelpCenter({
        homepageTitle: 'How can we help?',
        homepageDescription: 'Search the guides',
        ...locales('en', [], {
          de: {
            homepageTitle: 'Wie können wir helfen?',
            homepageDescription: 'Suche',
            searchPlaceholder: 'Suche hier',
          },
        }),
      })

      await updateLanguageConfig({ mainLanguage: 'de' })

      const config = await getHelpCenterConfig('fresh')
      expect(config.homepageTitle).toBe('Wie können wir helfen?')
      expect(config.locales).toEqual({
        default: 'de',
        additional: [],
        chrome: {
          de: { homepageTitle: '', homepageDescription: '', searchPlaceholder: 'Suche hier' },
          en: {
            homepageTitle: 'How can we help?',
            homepageDescription: 'Search the guides',
            searchPlaceholder: '',
          },
        },
      })
    })
  })

  describe('to an extra language (a swap)', () => {
    it('makes a published translation the article, and the old text a published translation', async () => {
      await storeHelpCenter(locales('en', ['de']))
      const cat = await seedCategory('Getting started')
      const id = await seedArticle(cat, 'Settings')
      await translate(id, 'de', 'Einstellungen')

      await updateLanguageConfig({ mainLanguage: 'de' })

      const row = await article(id)
      expect(row).toMatchObject({
        locale: 'de',
        title: 'Einstellungen',
        description: 'Einstellungen Zusammenfassung',
        content: 'Einstellungen **Text**',
      })
      expect(JSON.stringify(row.contentJson)).toContain('Einstellungen Text')
      expect(row.publishedAt).not.toBeNull()
      // Each text keeps the time it was last written.
      expect(row.updatedAt.getTime()).toBe(TRANSLATION_WRITTEN.getTime())
      const translations = await translationsOf(id)
      expect(Object.keys(translations)).toEqual(['en'])
      expect(translations.en).toMatchObject({
        title: 'Settings',
        description: 'Settings summary',
        content: 'Settings body',
        status: 'published',
      })
      expect(JSON.stringify(translations.en.contentJson)).toContain('Settings body')
      expect(translations.en.updatedAt.getTime()).toBe(ARTICLE_WRITTEN.getTime())
      // Search now stems the article as German.
      const [{ hit }] = await testDb.execute<{ hit: boolean }>(sql`
        SELECT search_vector @@ websearch_to_tsquery('german', 'Einstellung') AS hit
        FROM kb_articles WHERE id = ${toUuid(id)}`)
      expect(hit).toBe(true)
      await vi.waitFor(() => expect(embedded.ids).toEqual([id]))
    })

    it('never puts a draft live: a published article with a draft stays as it is', async () => {
      await storeHelpCenter(locales('en', ['de']))
      const cat = await seedCategory('Getting started')
      const id = await seedArticle(cat, 'Settings')
      await translate(id, 'de', 'Einstellungen', { status: 'draft' })

      await updateLanguageConfig({ mainLanguage: 'de' })

      expect(await article(id)).toMatchObject({ locale: 'en', title: 'Settings' })
      expect((await translationsOf(id)).de).toMatchObject({
        title: 'Einstellungen',
        status: 'draft',
      })
    })

    it('swaps an unpublished article with its draft, and the old text stays a draft', async () => {
      await storeHelpCenter(locales('en', ['de']))
      const cat = await seedCategory('Getting started')
      const id = await seedArticle(cat, 'Settings', { published: false })
      await translate(id, 'de', 'Einstellungen', { status: 'draft' })

      await updateLanguageConfig({ mainLanguage: 'de' })

      const row = await article(id)
      expect(row).toMatchObject({ locale: 'de', title: 'Einstellungen', publishedAt: null })
      expect((await translationsOf(id)).en.status).toBe('draft')
    })

    it('leaves an article with no version, or an empty one, in its own language', async () => {
      await storeHelpCenter(locales('en', ['de']))
      const cat = await seedCategory('Getting started')
      const untranslated = await seedArticle(cat, 'Billing')
      const empty = await seedArticle(cat, 'Refunds')
      await translate(empty, 'de', '  ')

      await updateLanguageConfig({ mainLanguage: 'de' })

      expect(await article(untranslated)).toMatchObject({ locale: 'en', title: 'Billing' })
      expect(await article(empty)).toMatchObject({ locale: 'en', title: 'Refunds' })
    })

    it('finds an article left in the old main language when searching in that language', async () => {
      await storeHelpCenter(locales('en', ['de']))
      const cat = await seedCategory('Getting started')
      const kept = await seedArticle(cat, 'Download invoices')
      const swapped = await seedArticle(cat, 'Invoice settings')
      await translate(swapped, 'de', 'Rechnungseinstellungen')

      await updateLanguageConfig({ mainLanguage: 'de' })

      const found = await hybridSearchForLocale('invoices', 'en', 10)
      expect(found.map((r) => [r.id, r.title]).sort()).toEqual(
        [
          [kept, 'Download invoices'],
          [swapped, 'Invoice settings'],
        ].sort()
      )
    })

    it('builds the rich body of a translation written as Markdown only', async () => {
      await storeHelpCenter(locales('en', ['de']))
      const cat = await seedCategory('Getting started')
      const id = await seedArticle(cat, 'Settings')
      await translate(id, 'de', 'Einstellungen', { richBody: false })

      await updateLanguageConfig({ mainLanguage: 'de' })

      const row = await article(id)
      expect(JSON.stringify(row.contentJson)).toContain('Einstellungen')
      expect(JSON.stringify(row.contentJson)).not.toContain('Settings body')
    })

    it('swaps deleted articles too, so a restored one is in step', async () => {
      await storeHelpCenter(locales('en', ['de']))
      const cat = await seedCategory('Getting started')
      const id = await seedArticle(cat, 'Settings', { deleted: true })
      await translate(id, 'de', 'Einstellungen')

      await updateLanguageConfig({ mainLanguage: 'de' })

      expect(await article(id)).toMatchObject({ locale: 'de', title: 'Einstellungen' })
    })

    it('swaps collection names, and leaves one with no name in the language in its own', async () => {
      await storeHelpCenter(locales('en', ['de']))
      const named = await seedCategory('Getting started')
      const unnamed = await seedCategory('Billing')
      const blank = await seedCategory('Account')
      await testDb.insert(helpCenterCategoryTranslations).values([
        { categoryId: named, locale: 'de', name: 'Erste Schritte', description: 'Los geht es' },
        { categoryId: blank, locale: 'de', name: ' ' },
      ])

      await updateLanguageConfig({ mainLanguage: 'de' })

      const swapped = await category(named)
      expect(swapped).toMatchObject({
        locale: 'de',
        name: 'Erste Schritte',
        description: 'Los geht es',
      })
      expect(Object.keys(swapped.translations)).toEqual(['en'])
      expect(swapped.translations.en).toMatchObject({
        name: 'Getting started',
        description: 'Getting started description',
      })
      expect(await category(unnamed)).toMatchObject({ locale: 'en', name: 'Billing' })
      expect(await category(blank)).toMatchObject({ locale: 'en', name: 'Account' })
    })

    it('moves the homepage words: the old main keeps its own, the new one brings its own', async () => {
      await storeHelpCenter({
        homepageTitle: 'How can we help you?',
        homepageDescription: 'Search the guides',
        ...locales('en', ['de', 'fr'], {
          de: {
            homepageTitle: 'Wie können wir helfen?',
            homepageDescription: 'Suche',
            searchPlaceholder: 'Suchen',
          },
          fr: { homepageTitle: 'Comment aider ?', homepageDescription: '', searchPlaceholder: '' },
        }),
      })

      await updateLanguageConfig({ mainLanguage: 'de' })

      const config = await getHelpCenterConfig('fresh')
      expect(config.homepageTitle).toBe('Wie können wir helfen?')
      expect(config.homepageDescription).toBe('Suche')
      expect(config.locales).toEqual({
        default: 'de',
        additional: ['en', 'fr'],
        chrome: {
          fr: { homepageTitle: 'Comment aider ?', homepageDescription: '', searchPlaceholder: '' },
          de: { homepageTitle: '', homepageDescription: '', searchPlaceholder: 'Suchen' },
          en: {
            homepageTitle: 'How can we help you?',
            homepageDescription: 'Search the guides',
            searchPlaceholder: '',
          },
        },
      })
    })

    it('goes there and back to where it started', async () => {
      const chrome = {
        de: {
          homepageTitle: 'Wie können wir helfen?',
          homepageDescription: 'Suche',
          searchPlaceholder: 'Suche hier',
        },
      }
      await storeHelpCenter(locales('en', ['de'], chrome))
      const cat = await seedCategory('Getting started')
      const id = await seedArticle(cat, 'Settings')
      await translate(id, 'de', 'Einstellungen')
      const before = { article: await article(id), translations: await translationsOf(id) }

      await updateLanguageConfig({ mainLanguage: 'de' })
      await updateLanguageConfig({ mainLanguage: 'en' })

      const after = await article(id)
      expect(after).toMatchObject({
        locale: 'en',
        title: before.article.title,
        content: before.article.content,
        contentJson: before.article.contentJson,
        updatedAt: before.article.updatedAt,
      })
      const translations = await translationsOf(id)
      expect(Object.keys(translations)).toEqual(['de'])
      expect(translations.de).toMatchObject({
        title: before.translations.de.title,
        content: before.translations.de.content,
        status: 'published',
      })
      expect((await getHelpCenterConfig('fresh')).locales).toMatchObject({
        default: 'en',
        additional: ['de'],
        chrome,
      })
    })

    it('deletes nothing: an article with a translation in its own language, which its own text hides, stays as it is', async () => {
      // An article left in English after German became the main language,
      // given an English translation by hand; French becomes the main language.
      await storeHelpCenter(locales('de', ['en', 'fr']))
      const cat = await seedCategory('Konto', 'de')
      const id = await seedArticle(cat, 'Invoices')
      await translate(id, 'en', 'Old invoices')
      await translate(id, 'fr', 'Factures')

      await updateLanguageConfig({ mainLanguage: 'fr' })

      expect(await article(id)).toMatchObject({ locale: 'en', title: 'Invoices' })
      const translations = await translationsOf(id)
      expect(
        Object.fromEntries(Object.entries(translations).map(([l, t]) => [l, t.title]))
      ).toEqual({ en: 'Old invoices', fr: 'Factures' })
    })

    it('counts beforehand exactly what it swaps and what it leaves', async () => {
      await storeHelpCenter(locales('en', ['de']))
      const cat = await seedCategory('Getting started')
      await testDb
        .insert(helpCenterCategoryTranslations)
        .values({ categoryId: cat, locale: 'de', name: 'Erste Schritte' })
      await seedCategory('Billing')
      const swapped = await seedArticle(cat, 'Settings')
      await translate(swapped, 'de', 'Einstellungen')
      const drafted = await seedArticle(cat, 'Refunds')
      await translate(drafted, 'de', 'Erstattungen', { status: 'draft' })
      await seedArticle(cat, 'Invoices')
      const deleted = await seedArticle(cat, 'Old', { deleted: true })
      await translate(deleted, 'de', 'Alt')

      const preview = await previewHelpCenterMainLanguage(testDb, {
        from: 'en',
        to: 'de',
        toIsExtraLanguage: true,
      })
      expect(preview).toEqual({
        swappedArticles: 1,
        swappedCollections: 1,
        relabelledArticles: 0,
        relabelledCollections: 0,
        keptArticles: 2,
        keptCollections: 1,
      })

      await updateLanguageConfig({ mainLanguage: 'de' })
      const [{ inGerman }] = await testDb
        .select({ inGerman: sql<number>`count(*)::int` })
        .from(helpCenterArticles)
        .where(and(eq(helpCenterArticles.locale, 'de'), sql`deleted_at IS NULL`))
      expect(inGerman).toBe(preview.swappedArticles)
    })

    it('counts the relabelled, swapped and kept content when the language is not an extra one', async () => {
      await storeHelpCenter(locales('en', []))
      const cat = await seedCategory('Getting started')
      await seedArticle(cat, 'Settings')
      await seedArticle(cat, 'Factures', { locale: 'fr' })
      const translated = await seedArticle(cat, 'Change your password')
      await translate(translated, 'de', 'Passwort ändern')
      const drafted = await seedArticle(cat, 'Refunds')
      await translate(drafted, 'de', 'Erstattungen', { status: 'draft' })

      const preview = await previewHelpCenterMainLanguage(testDb, {
        from: 'en',
        to: 'de',
        toIsExtraLanguage: false,
      })
      expect(preview).toEqual({
        swappedArticles: 1,
        swappedCollections: 0,
        relabelledArticles: 1,
        relabelledCollections: 1,
        keptArticles: 2,
        keptCollections: 0,
      })

      await updateLanguageConfig({ mainLanguage: 'de' })
      const [{ inGerman }] = await testDb
        .select({ inGerman: sql<number>`count(*)::int` })
        .from(helpCenterArticles)
        .where(and(eq(helpCenterArticles.locale, 'de'), sql`deleted_at IS NULL`))
      expect(inGerman).toBe(preview.swappedArticles + preview.relabelledArticles)
    })
  })
})

describe('helpCenterConfigForMainLanguage', () => {
  it('gives an old main language with no homepage title the default one, which an extra language needs', () => {
    const next = helpCenterConfigForMainLanguage(
      { ...DEFAULT_HELP_CENTER_CONFIG, homepageTitle: '', ...locales('en', ['de']) },
      'de'
    )
    expect(next.locales.chrome.en.homepageTitle).toBe(DEFAULT_HELP_CENTER_CONFIG.homepageTitle)
  })

  it.each(['de', 'fr', 'it'])(
    'puts the old main language where %s was, so a trip there and back keeps the order and what the plan holds',
    (to) => {
      const start = { ...DEFAULT_HELP_CENTER_CONFIG, ...locales('en', ['de', 'fr', 'it']) }

      const there = helpCenterConfigForMainLanguage(start, to)
      const back = helpCenterConfigForMainLanguage(there, 'en')

      expect(there.locales.additional).toEqual(['de', 'fr', 'it'].map((l) => (l === to ? 'en' : l)))
      expect(back.locales.additional).toEqual(['de', 'fr', 'it'])
      expect(extraHelpCenterLocales(back.locales.additional, 2)).toEqual(['fr', 'it'])
    }
  )

  it('keeps the old main language editable when the plan holds languages and the new one was editable', () => {
    const there = helpCenterConfigForMainLanguage(
      { ...DEFAULT_HELP_CENTER_CONFIG, ...locales('en', ['de', 'fr', 'it']) },
      'de'
    )

    expect(extraHelpCenterLocales(there.locales.additional, 2)).toEqual(['fr', 'it'])
  })
})
