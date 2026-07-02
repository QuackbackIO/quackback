import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateKbEmbedding = vi.fn()

vi.mock('@/lib/server/domains/help-center/help-center-embedding.service', () => ({
  generateKbEmbedding: (...args: unknown[]) => mockGenerateKbEmbedding(...args),
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
import { retrieveKbArticles, KB_ASK_CONTEXT_CHARS } from '../retrieval'

function row(id: string, content = 'body text') {
  return {
    id,
    slug: `slug-${id}`,
    title: `Title ${id}`,
    content,
    categoryId: 'kb_category_1',
    categorySlug: 'general',
    categoryName: 'General',
    score: 0.82,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue([])
})

describe('retrieveKbArticles', () => {
  it('uses the semantic path when a query embedding is available', async () => {
    mockGenerateKbEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mockLimit.mockResolvedValue([row('kb_article_1')])

    const result = await retrieveKbArticles('how do I invite teammates')

    expect(mockGenerateKbEmbedding).toHaveBeenCalledOnce()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'kb_article_1',
      slug: 'slug-kb_article_1',
      title: 'Title kb_article_1',
      categorySlug: 'general',
      categoryName: 'General',
    })
    expect(result[0].score).toBeCloseTo(0.82)
  })

  it('falls back to keyword retrieval when embeddings are unavailable', async () => {
    mockGenerateKbEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('kb_article_2')])

    const result = await retrieveKbArticles('billing')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('kb_article_2')
  })

  it('returns an empty list when nothing clears the similarity floor', async () => {
    mockGenerateKbEmbedding.mockResolvedValue([0.5])
    mockLimit.mockResolvedValue([])

    const result = await retrieveKbArticles('completely unrelated gibberish')
    expect(result).toEqual([])
  })

  it('trims article content to the context budget in SQL (left())', async () => {
    // The trim happens in the select itself, so whole long articles never
    // cross the wire just to be sliced in JS.
    mockGenerateKbEmbedding.mockResolvedValue([0.5])
    await retrieveKbArticles('long article')

    const trimCall = vi
      .mocked(sql)
      .mock.calls.find((c) => Array.isArray(c[0]) && (c[0] as string[]).join('?').includes('left('))
    expect(trimCall).toBeDefined()
    expect(trimCall).toContain(KB_ASK_CONTEXT_CHARS)
  })

  it('applies the public category predicate for the public audience', async () => {
    mockGenerateKbEmbedding.mockResolvedValue([0.5])
    await retrieveKbArticles('anything', { audience: 'public' })
    expect(vi.mocked(eq)).toHaveBeenCalledWith('is_public', true)
  })

  it('omits the public category predicate for the team audience', async () => {
    mockGenerateKbEmbedding.mockResolvedValue([0.5])
    await retrieveKbArticles('anything', { audience: 'team' })
    expect(vi.mocked(eq)).not.toHaveBeenCalledWith('is_public', true)
  })
})
