import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId } from '@quackback/ids'

const mockFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      changelogEntries: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        mockUpdateSet(...args)
        return { where: (...a: unknown[]) => mockUpdateWhere(...a) }
      },
    })),
  },
}))

const mockGenerateEmbedding = vi.fn()
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}))

vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: () => 'test-embedding-model',
}))

const mockLogError = vi.fn()
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => mockLogError(...args),
      debug: vi.fn(),
    }),
  },
}))

import { embedChangelogEntryOnPublish } from '../changelog-embedding.service'

const ENTRY_ID = 'changelog_1' as ChangelogId

beforeEach(() => {
  vi.clearAllMocks()
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
})

describe('embedChangelogEntryOnPublish', () => {
  it('embeds a published entry and persists the embedding column trio', async () => {
    mockFindFirst.mockResolvedValue({ id: ENTRY_ID, title: 'Dark mode', content: 'shipped it' })
    await embedChangelogEntryOnPublish(ENTRY_ID)

    expect(mockGenerateEmbedding).toHaveBeenCalledOnce()
    expect(mockUpdateSet).toHaveBeenCalledTimes(1)
    const set = mockUpdateSet.mock.calls[0][0]
    expect(set).toHaveProperty('embedding')
    expect(set.embeddingModel).toBe('test-embedding-model')
    expect(set.embeddingUpdatedAt).toBeInstanceOf(Date)
  })

  it('no-ops for a draft / not-found row (the query filters to published)', async () => {
    // The findFirst predicate excludes drafts/scheduled/deleted, so a draft
    // simply returns undefined here — no embed, no write.
    mockFindFirst.mockResolvedValue(undefined)
    await embedChangelogEntryOnPublish(ENTRY_ID)

    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('skips the write when embedding generation returns null (best-effort)', async () => {
    mockFindFirst.mockResolvedValue({ id: ENTRY_ID, title: 'X', content: 'Y' })
    mockGenerateEmbedding.mockResolvedValue(null)
    await embedChangelogEntryOnPublish(ENTRY_ID)

    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('never throws — a DB error is caught and logged', async () => {
    mockFindFirst.mockRejectedValue(new Error('db down'))
    await expect(embedChangelogEntryOnPublish(ENTRY_ID)).resolves.toBeUndefined()
    expect(mockLogError).toHaveBeenCalled()
  })
})
