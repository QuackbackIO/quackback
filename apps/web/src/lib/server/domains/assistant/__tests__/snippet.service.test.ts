/**
 * Real-DB coverage for the snippet service: create/list/update/delete, the
 * title/content length guards at both the service and DB layers, audience
 * validation, and embed-on-write (create + content/title update) with the
 * embedding call mocked so no real AI provider is hit. A generation failure
 * must not block the CRUD write — the row is still created/updated with a
 * null embedding.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantSnippets } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const mockGenerateEmbedding = vi.fn()
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}))

vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: () => 'text-embedding-3-small',
}))

import { createSnippet, listSnippets, updateSnippet, deleteSnippet } from '../snippet.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantSnippets.id }).from(assistantSnippets).limit(0)
  },
})

/** The embedding column is a fixed pgvector(1536); pad a short seed vector out
 *  to that width so real-DB writes don't fail the dimension check. */
function fakeVector(seed = 0.1): number[] {
  return Array.from({ length: 1536 }, () => seed)
}

describe.skipIf(!fixture.available)('snippet.service (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
    mockGenerateEmbedding.mockResolvedValue(fakeVector())
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('creates a snippet and lists it back, with defaults', async () => {
    const snippet = await createSnippet({
      title: 'Refund window',
      content: 'Refunds within 30 days.',
    })
    expect(snippet.enabled).toBe(true)
    expect(snippet.audience).toBe('team')

    const rows = await listSnippets()
    expect(rows.map((r) => r.id)).toEqual([snippet.id])
  })

  it('creates a snippet with an explicit audience and enabled flag', async () => {
    const snippet = await createSnippet({
      title: 'Public fact',
      content: 'This is public.',
      audience: 'public',
      enabled: false,
    })
    expect(snippet.audience).toBe('public')
    expect(snippet.enabled).toBe(false)
  })

  it('rejects an unknown audience at the service layer', async () => {
    await expect(
      createSnippet({ title: 'Bad audience', content: 'Body', audience: 'super-secret' as never })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('generates and stores an embedding on create', async () => {
    mockGenerateEmbedding.mockResolvedValue(fakeVector(0.4))
    const snippet = await createSnippet({ title: 'Embed me', content: 'Some content.' })

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      'Embed me\nSome content.',
      expect.objectContaining({ pipelineStep: expect.any(String) })
    )
    expect(snippet.embedding).not.toBeNull()
    expect(snippet.embeddingModel).toBe('text-embedding-3-small')
    expect(snippet.embeddingUpdatedAt).not.toBeNull()
  })

  it('does not block the create when embedding generation fails', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('provider down'))
    const snippet = await createSnippet({ title: 'No embed', content: 'Still saved.' })

    expect(snippet.id).toBeDefined()
    expect(snippet.embedding).toBeNull()
    expect(snippet.embeddingModel).toBeNull()

    const rows = await listSnippets()
    expect(rows.map((r) => r.id)).toContain(snippet.id)
  })

  it('does not block the create when the embedding call returns null', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    const snippet = await createSnippet({ title: 'No provider', content: 'Still saved.' })
    expect(snippet.embedding).toBeNull()
  })

  it('re-embeds on a content update', async () => {
    mockGenerateEmbedding.mockResolvedValue(fakeVector(0.1))
    const snippet = await createSnippet({ title: 'Original', content: 'Original body.' })
    mockGenerateEmbedding.mockClear()
    mockGenerateEmbedding.mockResolvedValue(fakeVector(0.9))

    const updated = await updateSnippet(snippet.id, { content: 'Updated body.' })

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      'Original\nUpdated body.',
      expect.objectContaining({ pipelineStep: expect.any(String) })
    )
    expect(updated?.content).toBe('Updated body.')
  })

  it('re-embeds on a title update', async () => {
    mockGenerateEmbedding.mockResolvedValue(fakeVector(0.1))
    const snippet = await createSnippet({ title: 'Old title', content: 'Body text.' })
    mockGenerateEmbedding.mockClear()
    mockGenerateEmbedding.mockResolvedValue(fakeVector(0.9))

    await updateSnippet(snippet.id, { title: 'New title' })

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      'New title\nBody text.',
      expect.objectContaining({ pipelineStep: expect.any(String) })
    )
  })

  it('does not re-embed when only enabled/audience change', async () => {
    mockGenerateEmbedding.mockResolvedValue(fakeVector(0.1))
    const snippet = await createSnippet({ title: 'Stable', content: 'Body text.' })
    mockGenerateEmbedding.mockClear()

    const updated = await updateSnippet(snippet.id, { enabled: false, audience: 'internal' })

    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
    expect(updated?.enabled).toBe(false)
    expect(updated?.audience).toBe('internal')
  })

  it('deletes a snippet', async () => {
    const snippet = await createSnippet({ title: 'Temp', content: 'Delete me.' })
    await deleteSnippet(snippet.id)
    expect(await listSnippets()).toHaveLength(0)
  })

  it('rejects a title over 120 characters at the service layer', async () => {
    await expect(createSnippet({ title: 'x'.repeat(121), content: 'Fine.' })).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR' }
    )
  })

  it('rejects content over 2000 characters at the service layer', async () => {
    await expect(
      createSnippet({ title: 'Too long', content: 'x'.repeat(2001) })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('DB CHECK constraint rejects an over-length title inserted directly', async () => {
    await expect(
      testDb.insert(assistantSnippets).values({ title: 'x'.repeat(121), content: 'Body' })
    ).rejects.toThrow()
  })

  it('DB CHECK constraint rejects an unknown audience inserted directly', async () => {
    await expect(
      testDb
        .insert(assistantSnippets)
        .values({ title: 'Bypass service', content: 'Body', audience: 'nope' as never })
    ).rejects.toThrow()
  })
})
