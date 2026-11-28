/**
 * The workspace's languages against the real settings row (rolled back): the
 * main language defaults to the help center's default, a change keeps the
 * help center's default language equal to it, and a language the help center
 * offers as an extra language cannot become the main language.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { createId, toUuid, type KbArticleId, type PrincipalId, type UserId } from '@quackback/ids'
import {
  eq,
  helpCenterArticles,
  helpCenterCategories,
  principal,
  settings,
  sql,
  user,
} from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { getLanguageConfig, updateLanguageConfig, getHelpCenterConfig, parseLanguageConfig } =
  await import('../settings.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.execute(sql`SELECT language_config FROM settings LIMIT 0`)
  },
})

async function storeHelpCenterLocales(locales: { default: string; additional: string[] }) {
  const values = { languageConfig: null, helpCenterConfig: JSON.stringify({ locales }) }
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (row) await testDb.update(settings).set(values)
  else
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date(), ...values })
}

describe('parseLanguageConfig', () => {
  it("falls back to the help center's default, then English", () => {
    expect(parseLanguageConfig(null, 'de')).toEqual({ mainLanguage: 'de', visitorLanguage: 'own' })
    expect(parseLanguageConfig(null, null)).toEqual({ mainLanguage: 'en', visitorLanguage: 'own' })
    expect(parseLanguageConfig('{"mainLanguage":"xx","visitorLanguage":"odd"}', 'fr')).toEqual({
      mainLanguage: 'fr',
      visitorLanguage: 'own',
    })
    expect(parseLanguageConfig('{"mainLanguage":"pt-BR","visitorLanguage":"main"}')).toEqual({
      mainLanguage: 'pt-br',
      visitorLanguage: 'main',
    })
  })
})

describe.skipIf(!fixture.available)('the workspace languages', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('starts from the help center default, so existing workspaces keep what they have', async () => {
    await storeHelpCenterLocales({ default: 'en', additional: ['fr'] })
    expect(await getLanguageConfig('fresh')).toEqual({
      mainLanguage: 'en',
      visitorLanguage: 'own',
    })
  })

  it('changes the main language and the help center default together', async () => {
    await storeHelpCenterLocales({ default: 'en', additional: ['fr'] })

    const next = await updateLanguageConfig({ mainLanguage: 'de', visitorLanguage: 'main' })

    expect(next).toEqual({ mainLanguage: 'de', visitorLanguage: 'main' })
    expect(await getLanguageConfig('fresh')).toEqual(next)
    const helpCenter = await getHelpCenterConfig('fresh')
    expect(helpCenter.locales.default).toBe('de')
    expect(helpCenter.locales.additional).toEqual(['fr'])
  })

  it('changes what visitors see without touching the main language', async () => {
    await storeHelpCenterLocales({ default: 'de', additional: [] })
    expect(await updateLanguageConfig({ visitorLanguage: 'main' })).toEqual({
      mainLanguage: 'de',
      visitorLanguage: 'main',
    })
  })

  it('refuses an extra help center language as the main language, and changes nothing', async () => {
    await storeHelpCenterLocales({ default: 'en', additional: ['de'] })

    await expect(updateLanguageConfig({ mainLanguage: 'de' })).rejects.toBeInstanceOf(
      ValidationError
    )
    expect((await getLanguageConfig('fresh')).mainLanguage).toBe('en')
    expect((await getHelpCenterConfig('fresh')).locales.default).toBe('en')
  })

  it('relabels every article, so search stems it by the new main language', async () => {
    await storeHelpCenterLocales({ default: 'en', additional: [] })
    const articleId = await seedArticle('Einstellungen öffnen', 'Öffne die Einstellungen.')
    // English rules leave the German word whole.
    expect(await vectorOf(articleId)).toContain("'einstellungen'")

    await updateLanguageConfig({ mainLanguage: 'de' })

    const [row] = await testDb
      .select({ locale: helpCenterArticles.locale })
      .from(helpCenterArticles)
      .where(eq(helpCenterArticles.id, articleId))
    expect(row.locale).toBe('de')
    // German rules stem it, as a German search for "Einstellung" does.
    expect(await vectorOf(articleId)).toContain("'einstell'")
    const [{ hit }] = await testDb.execute<{ hit: boolean }>(sql`
      SELECT search_vector @@ websearch_to_tsquery('german', 'Einstellung') AS hit
      FROM kb_articles WHERE id = ${toUuid(articleId)}`)
    expect(hit).toBe(true)
  })

  it('refuses a language the product does not have', async () => {
    await storeHelpCenterLocales({ default: 'en', additional: [] })
    await expect(updateLanguageConfig({ mainLanguage: 'xx' })).rejects.toBeInstanceOf(
      ValidationError
    )
  })
})

async function seedArticle(title: string, content: string): Promise<KbArticleId> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: 'Editor', email: `${userId}@example.com` })
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  const categoryId = createId('kb_category')
  await testDb
    .insert(helpCenterCategories)
    .values({ id: categoryId as never, slug: `c-${categoryId}`, name: 'Allgemein' })
  const articleId = createId('kb_article') as KbArticleId
  await testDb.insert(helpCenterArticles).values({
    id: articleId,
    categoryId: categoryId as never,
    slug: `a-${articleId}`,
    title,
    content,
    principalId,
  } as never)
  return articleId
}

async function vectorOf(articleId: KbArticleId): Promise<string> {
  const [row] = await testDb.execute<{ v: string }>(
    sql`SELECT search_vector::text AS v FROM kb_articles WHERE id = ${toUuid(articleId)}`
  )
  return row.v
}
