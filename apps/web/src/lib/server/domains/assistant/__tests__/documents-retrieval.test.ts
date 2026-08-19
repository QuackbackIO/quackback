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
  assistantDocuments: {
    id: 'id',
    title: 'title',
    content: 'content',
    embedding: 'embedding',
    deletedAt: 'deleted_at',
    updatedAt: 'updated_at',
  },
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  isNull: vi.fn((...args: unknown[]) => ({ op: 'isNull', args })),
  sql: Object.assign(
    vi.fn(() => {
      const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
      return stub
    }),
    { raw: vi.fn() }
  ),
}))

import { retrieveAssistantDocuments, documentsKnowledgeSource } from '../documents-retrieval'

function row(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    title: `Doc ${id}`,
    content: 'refunds are available within 30 days of purchase',
    score: 0.8,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue([])
})

describe('retrieveAssistantDocuments', () => {
  it('runs the hybrid query when a query embedding is available', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2])
    mockLimit.mockResolvedValue([row('assistant_document_1')])

    const docs = await retrieveAssistantDocuments('refund window', 'public')

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ id: 'assistant_document_1', score: 0.8 })
    expect(mockLimit).toHaveBeenCalledWith(5)
  })

  it('falls back to the keyword query when embeddings are unavailable', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('assistant_document_1', { score: 0 })])

    const docs = await retrieveAssistantDocuments('refund', 'team')

    expect(docs).toHaveLength(1)
    expect(docs[0].score).toBe(0)
  })

  it('returns an empty array when nothing matches', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1])
    expect(await retrieveAssistantDocuments('unknown', 'public')).toEqual([])
  })
})

describe('documentsKnowledgeSource', () => {
  it('maps rows onto RetrievedItem with a document citation and no internal flag', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1])
    mockLimit.mockResolvedValue([row('assistant_document_1')])

    const items = await documentsKnowledgeSource.retrieve('refund window', 'public', { topK: 5 })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'assistant_document_1',
      sourceType: 'document',
      title: 'Doc assistant_document_1',
      updatedAt: '2026-06-01T00:00:00.000Z',
      citation: {
        type: 'document',
        id: 'assistant_document_1',
        title: 'Doc assistant_document_1',
        url: '',
      },
    })
    expect(items[0].citation).not.toHaveProperty('internal')
  })

  it('is registered under the document source type', () => {
    expect(documentsKnowledgeSource.sourceType).toBe('document')
  })
})
