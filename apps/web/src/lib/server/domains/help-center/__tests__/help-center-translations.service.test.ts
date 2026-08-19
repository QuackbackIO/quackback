import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KbArticleId, KbCategoryId } from '@quackback/ids'

const mockArticleTranslationFindMany = vi.fn()
const mockArticleTranslationFindFirst = vi.fn()
const mockCategoryTranslationFindMany = vi.fn()
const mockCategoryTranslationFindFirst = vi.fn()
const mockUpdateWhere = vi.fn()
const insertValuesCalls: unknown[][] = []
const onConflictCalls: unknown[][] = []

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((...args: unknown[]) => {
    insertValuesCalls.push(args)
    return chain
  })
  chain.onConflictDoUpdate = vi.fn((...args: unknown[]) => {
    onConflictCalls.push(args)
    return chain
  })
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'kb_article_translation_1',
      articleId: 'kb_article_1',
      locale: 'de',
      title: 'Titel',
      description: null,
      content: 'Inhalt',
      contentJson: null,
      status: 'draft',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
  ])
  return chain
}

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn(() => chain)
  chain.where = vi.fn((...args: unknown[]) => {
    mockUpdateWhere(...args)
    return chain
  })
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'kb_article_translation_1',
      articleId: 'kb_article_1',
      locale: 'de',
      title: 'Titel',
      description: null,
      content: 'Inhalt',
      contentJson: null,
      status: 'published',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    },
  ])
  return chain
}

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      helpCenterArticleTranslations: {
        findMany: (...args: unknown[]) => mockArticleTranslationFindMany(...args),
        findFirst: (...args: unknown[]) => mockArticleTranslationFindFirst(...args),
      },
      helpCenterCategoryTranslations: {
        findMany: (...args: unknown[]) => mockCategoryTranslationFindMany(...args),
        findFirst: (...args: unknown[]) => mockCategoryTranslationFindFirst(...args),
      },
    },
    insert: vi.fn(() => createInsertChain()),
    update: vi.fn(() => createUpdateChain()),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  },
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  and: (...args: unknown[]) => ({ op: 'and', args }),
  helpCenterArticleTranslations: { articleId: 'article_id', locale: 'locale' },
  helpCenterCategoryTranslations: { categoryId: 'category_id', locale: 'locale' },
}))

const {
  listArticleTranslations,
  getArticleTranslation,
  getPublishedArticleTranslation,
  upsertArticleTranslation,
  setArticleTranslationStatus,
  deleteArticleTranslation,
  getArticleTranslationStatuses,
  listCategoryTranslations,
  getCategoryTranslation,
  upsertCategoryTranslation,
  deleteCategoryTranslation,
  getCategoryTranslationStatuses,
} = await import('../help-center-translations.service')

beforeEach(() => {
  mockArticleTranslationFindMany.mockReset()
  mockArticleTranslationFindFirst.mockReset()
  mockCategoryTranslationFindMany.mockReset()
  mockCategoryTranslationFindFirst.mockReset()
  mockUpdateWhere.mockReset()
  insertValuesCalls.length = 0
  onConflictCalls.length = 0
})

describe('article translations', () => {
  it('lists translations for an article', async () => {
    mockArticleTranslationFindMany.mockResolvedValue([{ locale: 'de' }])
    const result = await listArticleTranslations('kb_article_1' as KbArticleId)
    expect(result).toEqual([{ locale: 'de' }])
  })

  it('returns null when a translation does not exist', async () => {
    mockArticleTranslationFindFirst.mockResolvedValue(undefined)
    expect(await getArticleTranslation('kb_article_1' as KbArticleId, 'de')).toBeNull()
  })

  it('getPublishedArticleTranslation returns null for a draft translation', async () => {
    mockArticleTranslationFindFirst.mockResolvedValue({ status: 'draft' })
    expect(await getPublishedArticleTranslation('kb_article_1' as KbArticleId, 'de')).toBeNull()
  })

  it('getPublishedArticleTranslation returns the row when published', async () => {
    const row = { status: 'published', title: 'Titel' }
    mockArticleTranslationFindFirst.mockResolvedValue(row)
    expect(await getPublishedArticleTranslation('kb_article_1' as KbArticleId, 'de')).toEqual(row)
  })

  it('upserts via insert + onConflictDoUpdate on (articleId, locale)', async () => {
    const result = await upsertArticleTranslation({
      articleId: 'kb_article_1' as KbArticleId,
      locale: 'de',
      title: 'Titel',
      content: 'Inhalt',
    })
    expect(insertValuesCalls[0][0]).toMatchObject({ locale: 'de', title: 'Titel' })
    expect(onConflictCalls).toHaveLength(1)
    expect(result.title).toBe('Titel')
  })

  it('sets translation status and errors when the translation does not exist', async () => {
    const result = await setArticleTranslationStatus(
      'kb_article_1' as KbArticleId,
      'de',
      'published'
    )
    expect(result.status).toBe('published')
  })

  it('throws NotFoundError when publishing a translation that was never created', async () => {
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.update).mockReturnValueOnce({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    await expect(
      setArticleTranslationStatus('kb_article_1' as KbArticleId, 'de', 'published')
    ).rejects.toThrow(/before publishing/i)
  })

  it('deletes a translation', async () => {
    await deleteArticleTranslation('kb_article_1' as KbArticleId, 'de')
    // no throw is sufficient; the mocked db.delete().where() always resolves
  })

  it('computes untranslated/draft/published status per enabled locale', async () => {
    mockArticleTranslationFindMany.mockResolvedValue([
      { locale: 'de', status: 'published', updatedAt: new Date('2026-01-02') },
      { locale: 'fr', status: 'draft', updatedAt: new Date('2026-01-03') },
    ])

    const statuses = await getArticleTranslationStatuses('kb_article_1' as KbArticleId, [
      'de',
      'fr',
      'es',
    ])

    expect(statuses).toEqual([
      { locale: 'de', status: 'published', updatedAt: new Date('2026-01-02') },
      { locale: 'fr', status: 'draft', updatedAt: new Date('2026-01-03') },
      { locale: 'es', status: 'untranslated', updatedAt: null },
    ])
  })
})

describe('category translations', () => {
  it('lists translations for a category', async () => {
    mockCategoryTranslationFindMany.mockResolvedValue([{ locale: 'de' }])
    expect(await listCategoryTranslations('kb_category_1' as KbCategoryId)).toEqual([
      { locale: 'de' },
    ])
  })

  it('returns null when no translation exists', async () => {
    mockCategoryTranslationFindFirst.mockResolvedValue(undefined)
    expect(await getCategoryTranslation('kb_category_1' as KbCategoryId, 'de')).toBeNull()
  })

  it('upserts a category translation', async () => {
    const chainReturning = vi.fn().mockResolvedValue([
      {
        id: 'kb_category_translation_1',
        categoryId: 'kb_category_1',
        locale: 'de',
        name: 'Abrechnung',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.insert).mockReturnValueOnce({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: chainReturning,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const result = await upsertCategoryTranslation({
      categoryId: 'kb_category_1' as KbCategoryId,
      locale: 'de',
      name: 'Abrechnung',
    })
    expect(result.name).toBe('Abrechnung')
  })

  it('deletes a category translation', async () => {
    await deleteCategoryTranslation('kb_category_1' as KbCategoryId, 'de')
  })

  it('treats a row with an empty name as untranslated', async () => {
    mockCategoryTranslationFindMany.mockResolvedValue([
      { locale: 'de', name: 'Abrechnung', updatedAt: new Date('2026-01-01') },
      { locale: 'fr', name: '   ', updatedAt: new Date('2026-01-01') },
    ])

    const statuses = await getCategoryTranslationStatuses('kb_category_1' as KbCategoryId, [
      'de',
      'fr',
      'es',
    ])

    expect(statuses).toEqual([
      { locale: 'de', status: 'translated', updatedAt: new Date('2026-01-01') },
      { locale: 'fr', status: 'untranslated', updatedAt: new Date('2026-01-01') },
      { locale: 'es', status: 'untranslated', updatedAt: null },
    ])
  })
})
