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
  conversationSummaries: {
    conversationId: 'conversation_id',
    visitorPrincipalId: 'visitor_principal_id',
    summary: 'summary',
    embedding: 'embedding',
    createdAt: 'created_at',
  },
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  ne: vi.fn((...args: unknown[]) => ({ op: 'ne', args })),
  ilike: vi.fn((...args: unknown[]) => ({ op: 'ilike', args })),
  desc: vi.fn((...args: unknown[]) => ({ op: 'desc', args })),
  sql: Object.assign(
    vi.fn(() => {
      const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
      return stub
    }),
    { raw: vi.fn() }
  ),
}))

import { eq, ne } from '@/lib/server/db'
import {
  retrieveConversationSummaries,
  conversationSummariesKnowledgeSource,
} from '../conversation-summary-retrieval'

function row(conversationId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    conversationId,
    summary: `Summary for ${conversationId}`,
    score: 0.8,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue([])
})

describe('retrieveConversationSummaries: MANDATORY customer scope', () => {
  it('returns [] without touching the DB or generating an embedding when customerPrincipalId is absent', async () => {
    const items = await retrieveConversationSummaries('billing question', 'public', {
      conversationId: 'conversation_current' as never,
    })

    expect(items).toEqual([])
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it('returns [] when opts is entirely omitted (no customer, no conversation)', async () => {
    const items = await retrieveConversationSummaries('billing question', 'public')
    expect(items).toEqual([])
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it('filters on the given customerPrincipalId when present', async () => {
    mockGenerateEmbedding.mockResolvedValue(null) // exercise the keyword path
    mockLimit.mockResolvedValue([])

    await retrieveConversationSummaries('billing question', 'public', {
      customerPrincipalId: 'principal_customer_1' as never,
    })

    expect(vi.mocked(eq)).toHaveBeenCalledWith('visitor_principal_id', 'principal_customer_1')
  })

  it('excludes the current conversation when conversationId is given', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([])

    await retrieveConversationSummaries('billing question', 'public', {
      customerPrincipalId: 'principal_customer_1' as never,
      conversationId: 'conversation_current' as never,
    })

    expect(vi.mocked(ne)).toHaveBeenCalledWith('conversation_id', 'conversation_current')
  })

  it('does not exclude any conversation when conversationId is absent (still customer-scoped)', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([])

    await retrieveConversationSummaries('billing question', 'public', {
      customerPrincipalId: 'principal_customer_1' as never,
    })

    expect(vi.mocked(ne)).not.toHaveBeenCalled()
  })

  it('ignores the ceiling entirely — this source is customer-scoped, not audience-scoped', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('conversation_a')])

    const asPublic = await retrieveConversationSummaries('q', 'public', {
      customerPrincipalId: 'principal_customer_1' as never,
    })
    const asInternal = await retrieveConversationSummaries('q', 'internal', {
      customerPrincipalId: 'principal_customer_1' as never,
    })

    expect(asPublic).toEqual(asInternal)
  })
})

describe('retrieveConversationSummaries: ranking paths', () => {
  it('uses the semantic path when an embedding is available', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2])
    mockLimit.mockResolvedValue([row('conversation_a', { score: 0.9 })])

    const items = await retrieveConversationSummaries('billing', 'public', {
      customerPrincipalId: 'principal_customer_1' as never,
    })

    expect(items).toEqual([
      {
        conversationId: 'conversation_a',
        summary: 'Summary for conversation_a',
        score: 0.9,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ])
  })

  it('falls back to the keyword path when no embedding is available', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('conversation_b')])

    const items = await retrieveConversationSummaries('billing', 'public', {
      customerPrincipalId: 'principal_customer_1' as never,
    })

    expect(items).toHaveLength(1)
    expect(items[0].conversationId).toBe('conversation_b')
  })
})

describe('conversationSummariesKnowledgeSource', () => {
  it('maps a retrieved summary onto a RetrievedItem citing the PAST CONVERSATION id, not the row id', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('conversation_past_1', { score: 0.77 })])

    const items = await conversationSummariesKnowledgeSource.retrieve('billing', 'public', {
      topK: 5,
      customerPrincipalId: 'principal_customer_1' as never,
      conversationId: 'conversation_current' as never,
    })

    expect(items).toEqual([
      {
        id: 'conversation_past_1',
        sourceType: 'summary',
        title: 'Past conversation',
        excerpt: 'Summary for conversation_past_1',
        score: 0.77,
        // The summary row's createdAt (≈ when that conversation closed) is
        // the freshness timestamp the copilot citation line renders.
        updatedAt: '2026-06-01T00:00:00.000Z',
        citation: {
          type: 'summary',
          id: 'conversation_past_1',
          title: 'Past conversation',
          url: '',
          internal: true,
        },
      },
    ])
  })

  it('returns [] when the opts carry no customerPrincipalId (never falls back to unscoped)', async () => {
    mockLimit.mockResolvedValue([row('conversation_should_not_appear')])

    const items = await conversationSummariesKnowledgeSource.retrieve('billing', 'public', {
      topK: 5,
    })

    expect(items).toEqual([])
    expect(mockLimit).not.toHaveBeenCalled()
  })
})
