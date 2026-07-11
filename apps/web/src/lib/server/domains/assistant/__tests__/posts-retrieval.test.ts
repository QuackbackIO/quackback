import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateEmbedding = vi.fn()
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
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
  boards: {
    id: 'board_id',
    slug: 'slug',
    access: 'access',
    deletedAt: 'board_deleted_at',
  },
  posts: {
    id: 'id',
    title: 'title',
    content: 'content',
    boardId: 'board_id',
    deletedAt: 'deleted_at',
    canonicalPostId: 'canonical_post_id',
    moderationState: 'moderation_state',
    searchVector: 'search_vector',
    embedding: 'embedding',
  },
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  isNull: vi.fn((...args: unknown[]) => ({ op: 'isNull', args })),
  sql: Object.assign(
    vi.fn(() => {
      const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
      return stub
    }),
    { raw: vi.fn() }
  ),
}))

import { eq, isNull, sql } from '@/lib/server/db'
import {
  retrievePosts,
  postsVisibilityConditions,
  postsKnowledgeSource,
  POSTS_ASK_CONTEXT_CHARS,
  POSTS_SEMANTIC_SIMILARITY_FLOOR,
} from '../posts-retrieval'

function row(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    title: `Post ${id}`,
    content: 'post body',
    boardSlug: 'general',
    score: 0.82,
    isPublic: true,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue([])
})

describe('postsVisibilityConditions', () => {
  it('always excludes deleted, merged, non-published posts, and deleted boards', () => {
    const conditions = postsVisibilityConditions('team')
    expect(vi.mocked(isNull)).toHaveBeenCalledWith('deleted_at')
    expect(vi.mocked(isNull)).toHaveBeenCalledWith('canonical_post_id')
    expect(vi.mocked(eq)).toHaveBeenCalledWith('moderation_state', 'published')
    expect(vi.mocked(isNull)).toHaveBeenCalledWith('board_deleted_at')
    expect(conditions).toHaveLength(4)
  })

  it('adds the public-board predicate only for the public ceiling', () => {
    const publicConditions = postsVisibilityConditions('public')
    expect(publicConditions).toHaveLength(5)
    const boardCheck = vi
      .mocked(sql)
      .mock.calls.find(
        (c) =>
          Array.isArray(c[0]) && (c[0] as string[]).join('?').includes("->>'view' = 'anonymous'")
      )
    expect(boardCheck).toBeDefined()
  })

  it('does not add the public-board predicate for team or internal ceilings', () => {
    vi.mocked(sql).mockClear()
    postsVisibilityConditions('team')
    postsVisibilityConditions('internal')
    const boardCheck = vi
      .mocked(sql)
      .mock.calls.find(
        (c) => Array.isArray(c[0]) && (c[0] as string[]).join('?').includes("->>'view'")
      )
    expect(boardCheck).toBeUndefined()
  })
})

describe('retrievePosts', () => {
  it('uses the semantic path when a query embedding is available', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mockLimit.mockResolvedValue([row('post_1')])

    const result = await retrievePosts('dark mode', 'public')

    expect(mockGenerateEmbedding).toHaveBeenCalledOnce()
    expect(result).toEqual([
      {
        id: 'post_1',
        title: 'Post post_1',
        content: 'post body',
        boardSlug: 'general',
        score: 0.82,
        isPublic: true,
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ])
  })

  it('falls back to keyword retrieval when embeddings are unavailable', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('post_2')])

    const result = await retrievePosts('billing', 'public')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('post_2')
  })

  it('returns an empty list when nothing clears the floor / is visible', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.5])
    mockLimit.mockResolvedValue([])

    const result = await retrievePosts('unrelated', 'public')
    expect(result).toEqual([])
  })

  it('trims post content to the context budget in SQL (left())', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.5])
    await retrievePosts('long post', 'public')

    const trimCall = vi
      .mocked(sql)
      .mock.calls.find((c) => Array.isArray(c[0]) && (c[0] as string[]).join('?').includes('left('))
    expect(trimCall).toBeDefined()
    expect(trimCall).toContain(POSTS_ASK_CONTEXT_CHARS)
  })

  it('uses the answer floor as the default semantic minimum score', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.9])
    await retrievePosts('anything', 'public')
    const floorCall = vi
      .mocked(sql)
      .mock.calls.find((c) => (c as unknown[]).includes(POSTS_SEMANTIC_SIMILARITY_FLOOR))
    expect(floorCall).toBeDefined()
  })
})

describe('postsKnowledgeSource', () => {
  it('maps a retrieved post onto a RetrievedItem with a post citation', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([
      row('post_3', { title: 'Dark mode request', content: 'Y'.repeat(5000) }),
    ])

    const items = await postsKnowledgeSource.retrieve('dark mode', 'public', { topK: 5 })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'post_3',
      sourceType: 'post',
      title: 'Dark mode request',
      score: 0.82,
      citation: {
        type: 'post',
        id: 'post_3',
        title: 'Dark mode request',
        url: '/b/general/posts/post_3',
      },
    })
    expect(items[0].excerpt.length).toBeLessThanOrEqual(1200)
  })

  it('flags a post on a non-anonymous-viewable board as internal', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('post_4', { isPublic: false })])

    const items = await postsKnowledgeSource.retrieve('policy', 'team', { topK: 5 })
    expect(items[0].citation.internal).toBe(true)
  })

  it('leaves a post on an anonymous-viewable board unflagged (no internal key)', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('post_5', { isPublic: true })])

    const items = await postsKnowledgeSource.retrieve('policy', 'public', { topK: 5 })
    expect(items[0].citation).not.toHaveProperty('internal')
  })
})
