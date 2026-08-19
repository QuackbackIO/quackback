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
  changelogEntries: {
    id: 'id',
    title: 'title',
    content: 'content',
    embedding: 'embedding',
    publishedAt: 'published_at',
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

import { isNull, sql } from '@/lib/server/db'
import {
  retrieveChangelogEntries,
  changelogVisibilityConditions,
  changelogKnowledgeSource,
  CHANGELOG_CONTEXT_CHARS,
} from '../changelog-retrieval'

function row(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    title: `Entry ${id}`,
    content: 'shipped dark mode',
    score: 0.8,
    isPublished: true,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue([])
})

describe('changelogVisibilityConditions', () => {
  it('always excludes soft-deleted entries', () => {
    changelogVisibilityConditions('team')
    expect(vi.mocked(isNull)).toHaveBeenCalledWith('deleted_at')
  })

  it('adds the published-only predicate for the public ceiling', () => {
    const publicConditions = changelogVisibilityConditions('public')
    // deleted-at guard + published-not-null + published<=now
    expect(publicConditions).toHaveLength(3)
  })

  it('sees every non-deleted entry (incl. drafts) for team/internal ceilings', () => {
    expect(changelogVisibilityConditions('team')).toHaveLength(1)
    expect(changelogVisibilityConditions('internal')).toHaveLength(1)
  })
})

describe('retrieveChangelogEntries', () => {
  it('uses the semantic path when a query embedding is available', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mockLimit.mockResolvedValue([row('changelog_1')])

    const result = await retrieveChangelogEntries('dark mode', 'public')
    expect(result).toEqual([
      {
        id: 'changelog_1',
        title: 'Entry changelog_1',
        content: 'shipped dark mode',
        score: 0.8,
        isPublished: true,
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ])
  })

  it('falls back to keyword retrieval when embeddings are unavailable', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('changelog_2')])

    const result = await retrieveChangelogEntries('billing', 'team')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('changelog_2')
  })

  it('trims entry content to the context budget in SQL (left())', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.5])
    await retrieveChangelogEntries('long entry', 'public')
    const trimCall = vi
      .mocked(sql)
      .mock.calls.find((c) => Array.isArray(c[0]) && (c[0] as string[]).join('?').includes('left('))
    expect(trimCall).toBeDefined()
    expect(trimCall).toContain(CHANGELOG_CONTEXT_CHARS)
  })
})

describe('changelogKnowledgeSource', () => {
  it('maps a published entry to a public /changelog URL, not flagged internal', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('changelog_3', { title: 'Dark mode', isPublished: true })])

    const items = await changelogKnowledgeSource.retrieve('dark mode', 'public', { topK: 5 })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'changelog_3',
      sourceType: 'changelog',
      citation: {
        type: 'changelog',
        id: 'changelog_3',
        title: 'Dark mode',
        url: '/changelog/changelog_3',
      },
    })
    expect(items[0].citation).not.toHaveProperty('internal')
  })

  it('maps a draft entry to the admin editor URL and flags it internal (leak gate)', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    mockLimit.mockResolvedValue([row('changelog_4', { isPublished: false })])

    const items = await changelogKnowledgeSource.retrieve('unreleased', 'team', { topK: 5 })
    expect(items[0].citation.url).toBe('/admin/changelog?entry=changelog_4')
    expect(items[0].citation.internal).toBe(true)
  })
})
