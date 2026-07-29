import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KbArticleId } from '@quackback/ids'

const mockLimit = vi.fn()
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }))
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }))
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }))
const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }))
const mockSelect = vi.fn(() => ({ from: mockFrom }))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => mockSelect(),
  },
}))

let listArticlePerformance: typeof import('../help-center.article-performance.query').listArticlePerformance

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../help-center.article-performance.query')
  listArticlePerformance = mod.listArticlePerformance
})

describe('listArticlePerformance', () => {
  it('marks a row published when publishedAt is set and draft otherwise', async () => {
    mockLimit.mockResolvedValue([
      {
        id: 'kb_article_1' as KbArticleId,
        slug: 'popular-article',
        title: 'Popular Article',
        publishedAt: new Date('2024-01-01'),
        categoryName: 'Getting Started',
        viewCount: 500,
        helpfulCount: 40,
        notHelpfulCount: 5,
      },
      {
        id: 'kb_article_2' as KbArticleId,
        slug: 'draft-article',
        title: 'Draft Article',
        publishedAt: null,
        categoryName: 'Getting Started',
        viewCount: 10,
        helpfulCount: 0,
        notHelpfulCount: 0,
      },
    ])

    const result = await listArticlePerformance()

    expect(result).toEqual([
      {
        id: 'kb_article_1',
        slug: 'popular-article',
        title: 'Popular Article',
        status: 'published',
        categoryName: 'Getting Started',
        viewCount: 500,
        helpfulCount: 40,
        notHelpfulCount: 5,
      },
      {
        id: 'kb_article_2',
        slug: 'draft-article',
        title: 'Draft Article',
        status: 'draft',
        categoryName: 'Getting Started',
        viewCount: 10,
        helpfulCount: 0,
        notHelpfulCount: 0,
      },
    ])
  })

  it('orders by view count descending and respects the limit argument', async () => {
    mockLimit.mockResolvedValue([])

    await listArticlePerformance(25)

    expect(mockOrderBy).toHaveBeenCalled()
    expect(mockLimit).toHaveBeenCalledWith(25)
  })
})
