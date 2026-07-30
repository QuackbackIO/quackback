import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../help-center-embedding.service', () => ({
  generateKbEmbedding: vi.fn(),
  generateKbQueryEmbedding: vi.fn(),
}))

// Each query the service runs ends in .limit(); the queue feeds one result set
// per query, in order: source-article lookup, ranked candidates, same-category
// padding.
const resultsQueue: unknown[][] = []

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn(() => {
      const limit = vi.fn(() => Promise.resolve(resultsQueue.shift() ?? []))
      const orderBy = vi.fn(() => ({ limit }))
      const where = vi.fn(() => ({ orderBy, limit }))
      const innerJoin = vi.fn(() => ({ where }))
      const from = vi.fn(() => ({ innerJoin, where }))
      return { from }
    }),
  },
  helpCenterCategories: {
    id: 'cat_id',
    slug: 'cat_slug',
    name: 'cat_name',
    isPublic: 'is_public',
    deletedAt: 'cat_deleted_at',
    segmentIds: 'segment_ids',
  },
  helpCenterArticles: {
    id: 'id',
    slug: 'slug',
    title: 'title',
    description: 'description',
    content: 'content',
    categoryId: 'category_id',
    deletedAt: 'deleted_at',
    publishedAt: 'published_at',
    searchVector: 'search_vector',
    embedding: 'embedding',
  },
  helpCenterArticleTranslations: {
    articleId: 'article_id',
    locale: 'locale',
    status: 'status',
    title: 't_title',
    description: 't_description',
    content: 't_content',
    searchVector: 't_search_vector',
  },
  helpCenterCategoryTranslations: {
    categoryId: 'category_id',
    locale: 'locale',
    name: 't_name',
  },
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  ne: vi.fn((...args: unknown[]) => ({ op: 'ne', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  isNull: vi.fn((...args: unknown[]) => ({ op: 'isNull', args })),
  isNotNull: vi.fn((...args: unknown[]) => ({ op: 'isNotNull', args })),
  lte: vi.fn((...args: unknown[]) => ({ op: 'lte', args })),
  notInArray: vi.fn((...args: unknown[]) => ({ op: 'notInArray', args })),
  sql: Object.assign(
    vi.fn(() => {
      const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
      return stub
    }),
    { raw: vi.fn() }
  ),
  regconfigForLocale: vi.fn(() => 'english'),
}))

import { getRelatedArticles } from '../help-center-related.service'

const SOURCE = {
  id: 'kb_article_1',
  title: 'Invite your teammates',
  categoryId: 'kb_category_1',
  embedding: null as number[] | null,
}

const CANDIDATE = {
  id: 'kb_article_2',
  slug: 'manage-team-roles',
  title: 'Manage team roles',
  description: 'Roles and permissions',
  categorySlug: 'getting-started',
}

beforeEach(() => {
  vi.clearAllMocks()
  resultsQueue.length = 0
})

describe('getRelatedArticles', () => {
  it('returns an empty list when the source article does not exist', async () => {
    resultsQueue.push([])
    await expect(getRelatedArticles('kb_article_missing')).resolves.toEqual([])
  })

  it('ranks candidates by the source article embedding when one is stored', async () => {
    resultsQueue.push([{ ...SOURCE, embedding: [0.1, 0.2, 0.3] }])
    resultsQueue.push([CANDIDATE])

    const related = await getRelatedArticles(SOURCE.id)
    expect(related).toEqual([CANDIDATE])
  })

  it('falls back to title keyword matching when the source has no embedding', async () => {
    resultsQueue.push([SOURCE])
    resultsQueue.push([CANDIDATE])

    const related = await getRelatedArticles(SOURCE.id)
    expect(related).toEqual([CANDIDATE])
  })

  it('pads scarce matches with recent articles from the same category', async () => {
    const pad = {
      id: 'kb_article_3',
      slug: 'set-up-your-workspace',
      title: 'Set up your workspace',
      description: null,
      categorySlug: 'getting-started',
    }
    resultsQueue.push([SOURCE])
    resultsQueue.push([CANDIDATE])
    resultsQueue.push([pad])

    const related = await getRelatedArticles(SOURCE.id, 4)
    expect(related).toEqual([CANDIDATE, pad])
  })

  it('never repeats a candidate already ranked into the list', async () => {
    const other = {
      id: 'kb_article_4',
      slug: 'import-your-data',
      title: 'Import your data',
      description: null,
      categorySlug: 'getting-started',
    }
    resultsQueue.push([SOURCE])
    resultsQueue.push([CANDIDATE])
    resultsQueue.push([CANDIDATE, other])

    const related = await getRelatedArticles(SOURCE.id, 4)
    expect(related.map((r) => r.id)).toEqual([CANDIDATE.id, other.id])
  })
})
