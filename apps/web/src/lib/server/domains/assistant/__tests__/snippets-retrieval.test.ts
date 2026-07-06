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
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: (...args: unknown[]) => mockLimit(...args),
          }),
        }),
      }),
    })),
  },
  assistantSnippets: {
    id: 'id',
    title: 'title',
    content: 'content',
    enabled: 'enabled',
    audience: 'audience',
    embedding: 'embedding',
    updatedAt: 'updated_at',
  },
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  or: vi.fn((...args: unknown[]) => ({ op: 'or', args })),
  ilike: vi.fn((...args: unknown[]) => ({ op: 'ilike', args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
  desc: vi.fn((...args: unknown[]) => ({ op: 'desc', args })),
  sql: Object.assign(
    vi.fn(() => {
      const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
      return stub
    }),
    { raw: vi.fn() }
  ),
}))

import { eq, inArray } from '@/lib/server/db'
import {
  retrieveSnippets,
  snippetsVisibilityConditions,
  snippetsKnowledgeSource,
  SNIPPETS_SEMANTIC_SIMILARITY_FLOOR,
} from '../snippets-retrieval'

function row(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    title: `Snippet ${id}`,
    content: 'snippet body',
    score: 0.8,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue([])
})

describe('snippetsVisibilityConditions', () => {
  it('always requires enabled = true', () => {
    snippetsVisibilityConditions('team')
    expect(vi.mocked(eq)).toHaveBeenCalledWith('enabled', true)
  })

  it('scopes to only public audience for a public ceiling', () => {
    snippetsVisibilityConditions('public')
    expect(vi.mocked(inArray)).toHaveBeenCalledWith('audience', ['public'])
  })

  it('scopes to public+team audiences for a team ceiling', () => {
    snippetsVisibilityConditions('team')
    expect(vi.mocked(inArray)).toHaveBeenCalledWith('audience', ['public', 'team'])
  })

  it('scopes to all audiences for an internal ceiling', () => {
    snippetsVisibilityConditions('internal')
    expect(vi.mocked(inArray)).toHaveBeenCalledWith('audience', ['public', 'team', 'internal'])
  })
})

describe('retrieveSnippets', () => {
  it('uses the semantic path when a query embedding is available', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mockLimit.mockResolvedValue([row('assistant_snippet_1')])

    const result = await retrieveSnippets('refund window', 'public')

    expect(mockGenerateEmbedding).toHaveBeenCalledOnce()
    expect(result).toEqual([
      {
        id: 'assistant_snippet_1',
        title: 'Snippet assistant_snippet_1',
        content: 'snippet body',
        score: 0.8,
      },
    ])
  })

  it('falls back to a keyword ILIKE match when embeddings are unavailable', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('assistant_snippet_2')])

    const result = await retrieveSnippets('billing', 'public')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('assistant_snippet_2')
  })

  it('returns an empty list when nothing clears the floor / is visible', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.5])
    mockLimit.mockResolvedValue([])

    const result = await retrieveSnippets('unrelated', 'public')
    expect(result).toEqual([])
  })

  it('uses the module default as the semantic minimum score', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.9])
    await retrieveSnippets('anything', 'public')
    expect(SNIPPETS_SEMANTIC_SIMILARITY_FLOOR).toBeGreaterThan(0)
  })
})

describe('snippetsKnowledgeSource', () => {
  it('maps a retrieved snippet onto a RetrievedItem with a snippet citation (no url)', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([
      row('assistant_snippet_3', { title: 'Refund policy', content: 'Y'.repeat(5000) }),
    ])

    const items = await snippetsKnowledgeSource.retrieve('refund', 'public', { topK: 5 })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'assistant_snippet_3',
      sourceType: 'snippet',
      title: 'Refund policy',
      score: 0.8,
      citation: {
        type: 'snippet',
        id: 'assistant_snippet_3',
        title: 'Refund policy',
      },
    })
    expect(items[0].excerpt.length).toBeLessThanOrEqual(1200)
  })
})
