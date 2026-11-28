/**
 * An article or collection can be translated into the help center's
 * languages other than the one its own text is in. That is the extra
 * languages for an item in the main language, and also the main language for
 * one a change of main language left in its old language. A translation in an
 * item's own language would never show, so the writes refuse it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  own: 'en' as string | null,
  writes: [] as string[],
  statusLocales: [] as string[][],
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler<T>(fn: T) {
        return fn
      },
    }
    return chain
  },
}))
vi.mock('../auth-helpers', () => ({ requireAuth: async () => ({}) }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getHelpCenterConfig: async () => ({
    locales: { default: 'de', additional: ['en', 'fr'], chrome: {} },
  }),
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.locales', () => ({
  assertHelpCenterLocaleEditable: async () => {},
}))
vi.mock('@/lib/server/domains/help-center/help-center-translate-queue', () => ({
  listPausedTranslationLocales: async () => [],
}))
vi.mock('@/lib/server/domains/help-center/help-center-translations.service', async (original) => {
  const real =
    await original<
      typeof import('@/lib/server/domains/help-center/help-center-translations.service')
    >()
  const write =
    (name: string) =>
    async (...args: unknown[]) => {
      const input = args[0] as { locale?: string } | string
      hoisted.writes.push(`${name}:${typeof input === 'string' ? args[1] : input.locale}`)
      return {}
    }
  const statuses = async (_id: string, locales: string[]) => {
    hoisted.statusLocales.push(locales)
    return []
  }
  return {
    translatableLocales: real.translatableLocales,
    assertNotOwnLanguage: real.assertNotOwnLanguage,
    getArticleLocale: async () => hoisted.own,
    getCategoryLocale: async () => hoisted.own,
    listArticleTranslations: async () => [],
    getArticleTranslationStatuses: statuses,
    upsertArticleTranslation: write('upsertArticle'),
    setArticleTranslationStatus: write('setArticleStatus'),
    deleteArticleTranslation: write('deleteArticle'),
    listCategoryTranslations: async () => [],
    getCategoryTranslationStatuses: statuses,
    upsertCategoryTranslation: write('upsertCategory'),
    deleteCategoryTranslation: write('deleteCategory'),
  }
})

const fns = (await import('../help-center-translations')) as unknown as Record<
  string,
  (args: { data: Record<string, unknown> }) => Promise<unknown>
>

beforeEach(() => {
  hoisted.own = 'en'
  hoisted.writes = []
  hoisted.statusLocales = []
})

describe('help center translations in an item’s own language', () => {
  it('lists the main language and the other extra ones for an item left in an old main language', async () => {
    await fns.getArticleTranslationStatusesFn!({ data: { articleId: 'a' } })
    await fns.getCategoryTranslationStatusesFn!({ data: { categoryId: 'c' } })

    expect(hoisted.statusLocales).toEqual([
      ['de', 'fr'],
      ['de', 'fr'],
    ])
  })

  it('lists the extra languages for an item in the main language', async () => {
    hoisted.own = 'de'
    await fns.getArticleTranslationStatusesFn!({ data: { articleId: 'a' } })

    expect(hoisted.statusLocales).toEqual([['en', 'fr']])
  })

  it('refuses to write a translation in the item’s own language, and writes another', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['upsertArticleTranslationFn', { articleId: 'a', title: 'T', content: 'C' }],
      ['setArticleTranslationStatusFn', { articleId: 'a', status: 'published' }],
      ['upsertCategoryTranslationFn', { categoryId: 'c', name: 'N' }],
    ]
    for (const [name, data] of calls) {
      const refused = await fns[name]!({ data: { ...data, locale: 'en' } }).catch(
        (e: { code?: string }) => e.code
      )
      expect(refused, name).toBe('TRANSLATION_IN_OWN_LANGUAGE')
      await fns[name]!({ data: { ...data, locale: 'de' } })
    }
    expect(hoisted.writes).toEqual(['upsertArticle:de', 'setArticleStatus:de', 'upsertCategory:de'])
  })

  it('still deletes a translation in the item’s own language, so one made earlier can be cleaned up', async () => {
    await fns.deleteArticleTranslationFn!({ data: { articleId: 'a', locale: 'en' } })
    await fns.deleteCategoryTranslationFn!({ data: { categoryId: 'c', locale: 'en' } })

    expect(hoisted.writes).toEqual(['deleteArticle:en', 'deleteCategory:en'])
  })
})
