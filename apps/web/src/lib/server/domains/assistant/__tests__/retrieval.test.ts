import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateHelpCenterEmbedding = vi.fn()

vi.mock('@/lib/server/domains/help-center/help-center-embedding.service', () => ({
  generateHelpCenterEmbedding: (...args: unknown[]) => mockGenerateHelpCenterEmbedding(...args),
  generateHelpCenterQueryEmbedding: (...args: unknown[]) =>
    mockGenerateHelpCenterEmbedding(...args),
}))

// Terminal `.limit()` resolves with whatever rows the test seeded.
const mockLimit = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: (...args: unknown[]) => mockLimit(...args),
            }),
          }),
        }),
      }),
    })),
  },
  helpCenterCategories: {
    id: 'id',
    slug: 'slug',
    name: 'name',
    isPublic: 'is_public',
    deletedAt: 'deleted_at',
  },
  helpCenterArticles: {
    id: 'id',
    slug: 'slug',
    title: 'title',
    content: 'content',
    categoryId: 'category_id',
    deletedAt: 'deleted_at',
    publishedAt: 'published_at',
    searchVector: 'search_vector',
    embedding: 'embedding',
  },
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  isNull: vi.fn((...args: unknown[]) => ({ op: 'isNull', args })),
  isNotNull: vi.fn((...args: unknown[]) => ({ op: 'isNotNull', args })),
  lte: vi.fn((...args: unknown[]) => ({ op: 'lte', args })),
  sql: Object.assign(
    vi.fn(() => {
      const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
      return stub
    }),
    { raw: vi.fn() }
  ),
}))

import { eq, sql } from '@/lib/server/db'
import { SEMANTIC_SIMILARITY_FLOOR } from '@/lib/server/domains/help-center/help-center-search.service'
import { retrieveHelpCenterArticles, HELP_CENTER_ASK_CONTEXT_CHARS } from '../retrieval'

function row(id: string, content = 'body text') {
  const trailingDigits = id.match(/(\d+)$/)
  return {
    id,
    urlId: trailingDigits ? Number(trailingDigits[1]) : 1,
    slug: `slug-${id}`,
    title: `Title ${id}`,
    content,
    categoryId: 'category_1',
    categorySlug: 'general',
    categoryName: 'General',
    score: 0.82,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue([])
})

describe('retrieveHelpCenterArticles', () => {
  it('uses the semantic path when a query embedding is available', async () => {
    mockGenerateHelpCenterEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mockLimit.mockResolvedValue([row('article_1')])

    const result = await retrieveHelpCenterArticles('how do I invite teammates')

    expect(mockGenerateHelpCenterEmbedding).toHaveBeenCalledOnce()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'article_1',
      slug: 'slug-article_1',
      title: 'Title article_1',
      categorySlug: 'general',
      categoryName: 'General',
    })
    expect(result[0].score).toBeCloseTo(0.82)
  })

  it('falls back to keyword retrieval when embeddings are unavailable', async () => {
    mockGenerateHelpCenterEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('article_2')])

    const result = await retrieveHelpCenterArticles('billing')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('article_2')
  })

  it('returns an empty list when nothing clears the similarity floor', async () => {
    mockGenerateHelpCenterEmbedding.mockResolvedValue([0.5])
    mockLimit.mockResolvedValue([])

    const result = await retrieveHelpCenterArticles('completely unrelated gibberish')
    expect(result).toEqual([])
  })

  it('trims article content to the context budget in SQL (left())', async () => {
    // The trim happens in the select itself, so whole long articles never
    // cross the wire just to be sliced in JS.
    mockGenerateHelpCenterEmbedding.mockResolvedValue([0.5])
    await retrieveHelpCenterArticles('long article')

    const trimCall = vi
      .mocked(sql)
      .mock.calls.find((c) => Array.isArray(c[0]) && (c[0] as string[]).join('?').includes('left('))
    expect(trimCall).toBeDefined()
    expect(trimCall).toContain(HELP_CENTER_ASK_CONTEXT_CHARS)
  })

  it('uses the answer floor as the default semantic minimum score', async () => {
    mockGenerateHelpCenterEmbedding.mockResolvedValue([0.9])
    await retrieveHelpCenterArticles('anything')
    const floorCall = vi
      .mocked(sql)
      .mock.calls.find((c) => (c as unknown[]).includes(SEMANTIC_SIMILARITY_FLOOR))
    expect(floorCall).toBeDefined()
  })

  it('lowers the semantic floor when minScore is given (related near-misses)', async () => {
    mockGenerateHelpCenterEmbedding.mockResolvedValue([0.5])
    await retrieveHelpCenterArticles('anything', { minScore: 0.3 })
    const floorCall = vi.mocked(sql).mock.calls.find((c) => (c as unknown[]).includes(0.3))
    expect(floorCall).toBeDefined()
  })

  it('applies the public category predicate for the public audience', async () => {
    mockGenerateHelpCenterEmbedding.mockResolvedValue([0.5])
    await retrieveHelpCenterArticles('anything', { audience: 'public' })
    expect(vi.mocked(eq)).toHaveBeenCalledWith('is_public', true)
  })

  it('omits the public category predicate for the team audience', async () => {
    mockGenerateHelpCenterEmbedding.mockResolvedValue([0.5])
    await retrieveHelpCenterArticles('anything', { audience: 'team' })
    expect(vi.mocked(eq)).not.toHaveBeenCalledWith('is_public', true)
  })

  it('maps the computed isPublic flag through for a team-only row (the copilot leak gate reads this)', async () => {
    mockGenerateHelpCenterEmbedding.mockResolvedValue([0.5])
    mockLimit.mockResolvedValue([{ ...row('article_private'), isPublic: false }])

    const result = await retrieveHelpCenterArticles('anything', { audience: 'team' })
    expect(result[0].isPublic).toBe(false)
  })

  it('maps the computed isPublic flag through for a public row', async () => {
    mockGenerateHelpCenterEmbedding.mockResolvedValue([0.5])
    mockLimit.mockResolvedValue([{ ...row('article_public'), isPublic: true }])

    const result = await retrieveHelpCenterArticles('anything', { audience: 'public' })
    expect(result[0].isPublic).toBe(true)
  })
})
