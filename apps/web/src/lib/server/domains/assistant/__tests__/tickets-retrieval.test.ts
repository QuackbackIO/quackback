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
  ticketSummaries: {
    ticketId: 'ticket_id',
    summary: 'summary',
    embedding: 'embedding',
    createdAt: 'created_at',
  },
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  desc: vi.fn((...args: unknown[]) => ({ op: 'desc', args })),
  ilike: vi.fn((...args: unknown[]) => ({ op: 'ilike', args })),
  sql: Object.assign(
    vi.fn(() => {
      const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
      return stub
    }),
    { raw: vi.fn() }
  ),
}))

import { retrieveTicketSummaries, ticketsKnowledgeSource } from '../tickets-retrieval'

function row(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ticketId: id,
    summary: 'SSO login broke; fixed by re-adding the callback URL.',
    score: 0.77,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue([])
})

describe('retrieveTicketSummaries', () => {
  it('returns [] unconditionally at the public ceiling (never queries)', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2])
    const result = await retrieveTicketSummaries('anything', 'public')
    expect(result).toEqual([])
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it('uses the semantic path when a query embedding is available', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mockLimit.mockResolvedValue([row('ticket_1')])

    const result = await retrieveTicketSummaries('sso', 'team')
    expect(result).toEqual([
      {
        ticketId: 'ticket_1',
        summary: 'SSO login broke; fixed by re-adding the callback URL.',
        score: 0.77,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ])
  })

  it('falls back to keyword retrieval when embeddings are unavailable', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('ticket_2')])

    const result = await retrieveTicketSummaries('billing', 'team')
    expect(result).toHaveLength(1)
    expect(result[0].ticketId).toBe('ticket_2')
  })
})

describe('ticketsKnowledgeSource', () => {
  it('returns [] at the public ceiling (tickets are never customer knowledge)', async () => {
    const items = await ticketsKnowledgeSource.retrieve('q', 'public', { topK: 5 })
    expect(items).toEqual([])
  })

  it('maps a ticket summary onto a RetrievedItem with an always-internal ticket citation', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('ticket_3', { summary: 'X'.repeat(5000) })])

    const items = await ticketsKnowledgeSource.retrieve('sso', 'team', { topK: 5 })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'ticket_3',
      sourceType: 'ticket',
      citation: {
        type: 'ticket',
        id: 'ticket_3',
        url: '/admin/inbox?i=ticket_3',
        internal: true,
      },
    })
    expect(items[0].excerpt.length).toBeLessThanOrEqual(1200)
  })
})
