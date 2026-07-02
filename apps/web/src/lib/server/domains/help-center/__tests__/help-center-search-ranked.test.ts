import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateKbEmbedding = vi.fn()
vi.mock('../help-center-embedding.service', () => ({
  generateKbEmbedding: (...args: unknown[]) => mockGenerateKbEmbedding(...args),
}))

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
    deletedAt: 'cat_deleted_at',
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

import { eq, isNull, isNotNull } from '@/lib/server/db'
import { searchArticleIdsRanked } from '../help-center-search.service'

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue([])
})

describe('searchArticleIdsRanked', () => {
  it('returns ranked ids from the semantic path when embeddings are available', async () => {
    mockGenerateKbEmbedding.mockResolvedValue([0.1, 0.2])
    mockLimit.mockResolvedValue([{ id: 'kb_article_2' }, { id: 'kb_article_1' }])

    const ids = await searchArticleIdsRanked('invite teammates', { audience: 'team' })
    expect(ids).toEqual(['kb_article_2', 'kb_article_1'])
  })

  it('falls back to keyword ranking when embeddings are unavailable', async () => {
    mockGenerateKbEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([{ id: 'kb_article_3' }])

    const ids = await searchArticleIdsRanked('billing', { audience: 'team' })
    expect(ids).toEqual(['kb_article_3'])
  })

  it('team audience sees drafts and private categories', async () => {
    mockGenerateKbEmbedding.mockResolvedValue(null)
    await searchArticleIdsRanked('q', { audience: 'team' })
    expect(vi.mocked(eq)).not.toHaveBeenCalledWith('is_public', true)
    expect(vi.mocked(isNotNull)).not.toHaveBeenCalledWith('published_at')
    // Soft-deleted rows stay hidden for everyone.
    expect(vi.mocked(isNull)).toHaveBeenCalledWith('deleted_at')
  })

  it('public audience enforces the published + public-category predicate', async () => {
    mockGenerateKbEmbedding.mockResolvedValue(null)
    await searchArticleIdsRanked('q', { audience: 'public' })
    expect(vi.mocked(eq)).toHaveBeenCalledWith('is_public', true)
    expect(vi.mocked(isNotNull)).toHaveBeenCalledWith('published_at')
  })

  it('applies status and category filters for team callers', async () => {
    mockGenerateKbEmbedding.mockResolvedValue(null)
    await searchArticleIdsRanked('q', {
      audience: 'team',
      status: 'draft',
      categoryId: 'kb_category_9',
    })
    expect(vi.mocked(isNull)).toHaveBeenCalledWith('published_at')
    expect(vi.mocked(eq)).toHaveBeenCalledWith('category_id', 'kb_category_9')
  })
})
