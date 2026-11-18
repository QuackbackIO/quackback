/**
 * A help center language the plan holds back (past its cap, after the grace)
 * keeps its published pages but cannot be edited: the translation writes
 * refuse it, and only it.
 *
 * The plan limits state is a stand-in for the real reader's view; which
 * languages it holds is the real rule (plan-limits.locales.ts), proved against
 * a database in plan-limits.team.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  view: null as null | Record<string, unknown>,
  writes: [] as string[],
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
    locales: { default: 'en', additional: ['fr', 'de'], chrome: {} },
  }),
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  getPlanLimits: async () => hoisted.view,
}))
vi.mock('@/lib/server/domains/help-center/help-center-translations.service', () => {
  const write =
    (name: string) =>
    async (...args: unknown[]) => {
      const input = args[0] as { locale?: string } | string
      hoisted.writes.push(`${name}:${typeof input === 'string' ? args[1] : input.locale}`)
      return {}
    }
  return {
    listArticleTranslations: async () => [],
    getArticleTranslationStatuses: async () => ({}),
    upsertArticleTranslation: write('upsertArticle'),
    setArticleTranslationStatus: write('setArticleStatus'),
    deleteArticleTranslation: write('deleteArticle'),
    listCategoryTranslations: async () => [],
    getCategoryTranslationStatuses: async () => ({}),
    upsertCategoryTranslation: write('upsertCategory'),
    deleteCategoryTranslation: write('deleteCategory'),
  }
})

const fns = (await import('../help-center-translations')) as unknown as Record<
  string,
  (args: { data: Record<string, unknown> }) => Promise<unknown>
>

const ENFORCED = {
  enabled: true,
  phase: 'enforced',
  issues: [{ key: 'maxHelpCenterLocales', used: 3, cap: 2 }],
}

const calls: Array<[string, Record<string, unknown>]> = [
  ['upsertArticleTranslationFn', { articleId: 'a', title: 'T', content: 'C' }],
  ['setArticleTranslationStatusFn', { articleId: 'a', status: 'published' }],
  ['deleteArticleTranslationFn', { articleId: 'a' }],
  ['upsertCategoryTranslationFn', { categoryId: 'c', name: 'N' }],
  ['deleteCategoryTranslationFn', { categoryId: 'c' }],
]

beforeEach(() => {
  hoisted.writes = []
  hoisted.view = null
})

describe('help center translation writes', () => {
  it('refuse a held language once enforced, and still write the kept one', async () => {
    hoisted.view = ENFORCED
    for (const [name, data] of calls) {
      const refused = await fns[name]!({ data: { ...data, locale: 'de' } }).catch(
        (e: { code?: string }) => e.code
      )
      expect(refused, name).toBe('HC_LOCALE_HELD')
      await fns[name]!({ data: { ...data, locale: 'fr' } })
    }
    expect(hoisted.writes.every((w) => w.endsWith(':fr'))).toBe(true)
    expect(hoisted.writes).toHaveLength(calls.length)
  })

  it('write every language in the grace and with the flag off', async () => {
    for (const view of [
      { ...ENFORCED, phase: 'grace' },
      { ...ENFORCED, enabled: false, phase: 'ok', issues: [] },
    ]) {
      hoisted.view = view
      for (const [name, data] of calls) await fns[name]!({ data: { ...data, locale: 'de' } })
    }
    expect(hoisted.writes).toHaveLength(calls.length * 2)
  })
})
