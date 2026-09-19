/**
 * The derived passage index (QUINN-PRODUCT P5/P6), against a real database.
 *
 * The case this file exists for is the one the whole-source adapters cannot
 * answer: a fact that lives after character 8,000 of a long source. The old
 * shape embedded a prefix and handed the model another prefix, so the passage
 * carrying the fact was never supplied even when the row itself matched. Each
 * assertion below is about the passage actually handed to the generator, not
 * about whether the row was found.
 *
 * Embeddings are stubbed rather than live. The lexical arm is what proves the
 * passage is reachable; the vector arm's contract that matters here is the one
 * about generations, which is asserted on the recorded model rather than on a
 * similarity score no fake could make meaningful.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantChunks,
  assistantDocuments,
  assistantKnowledgeSources,
  assistantSourceVersions,
  assistantWebSources,
  helpCenterArticles,
  helpCenterCategories,
  principal,
  and,
  eq,
} from '@/lib/server/db'
import { toUuid } from '@quackback/ids'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const embeddingModel = vi.hoisted(() => vi.fn<() => string | null>(() => null))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: embeddingModel,
  getChatModel: () => null,
  isVisionCapableModel: () => false,
}))
const generateEmbedding = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/embeddings/embedding.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/embeddings/embedding.service')>()),
  generateEmbedding,
}))
const kbQueryEmbedding = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/help-center/help-center-embedding.service', async (original) => ({
  ...(await original<
    typeof import('@/lib/server/domains/help-center/help-center-embedding.service')
  >()),
  generateKbQueryEmbedding: kbQueryEmbedding,
}))

import { retrieveKnowledge } from '../retrieval-sources'
import { indexKnowledgeSource } from '../knowledge-index.service'
import { listKnowledgeSourceHealth } from '../knowledge-index.reads'

/** Filler that shares no lexeme with the probe query below. */
const FILLER = 'Onboarding checklist step. '.repeat(400)
const LATE_FACT =
  '\n\n## Zephyr allowance\nEvery Zephyr workspace receives fourteen complimentary Zephyr passes.\n'
const LATE_QUERY = 'Zephyr passes allowance'

function longBody(): string {
  const body = `${FILLER}${LATE_FACT}`
  if (body.indexOf('Zephyr') <= 8000) throw new Error('fixture fact must sit past character 8,000')
  return body
}

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantChunks.id }).from(assistantChunks).limit(0)
  },
})

describe.skipIf(!fixture.available)('derived passage index (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    embeddingModel.mockReturnValue(null)
    generateEmbedding.mockResolvedValue(null)
    kbQueryEmbedding.mockResolvedValue(null)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function seedArticle(content: string, overrides: { isPublic?: boolean } = {}) {
    const [author] = await testDb
      .insert(principal)
      .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
      .returning()
    const [category] = await testDb
      .insert(helpCenterCategories)
      .values({
        name: 'Index test',
        slug: `quinn-index-${Math.random().toString(36).slice(2, 10)}`,
        isPublic: overrides.isPublic ?? true,
      })
      .returning()
    const [article] = await testDb
      .insert(helpCenterArticles)
      .values({
        categoryId: category.id,
        principalId: author.id,
        title: 'Workspace onboarding checklist',
        slug: `quinn-index-article-${Math.random().toString(36).slice(2, 10)}`,
        content,
        publishedAt: new Date(),
      })
      .returning()
    return { article, category }
  }

  async function seedDocument(content: string, title = 'Workspace onboarding handbook') {
    const [document] = await testDb
      .insert(assistantDocuments)
      .values({ title, fileName: 'handbook.pdf', mimeType: 'application/pdf', content })
      .returning()
    return document
  }

  async function seedWebPage(content: string) {
    const [page] = await testDb
      .insert(assistantWebSources)
      .values({
        url: `https://example.test/quinn-index-${Math.random().toString(36).slice(2, 10)}`,
        title: 'Workspace onboarding page',
        content,
        fetchedAt: new Date(),
      })
      .returning()
    return page
  }

  async function activeVersion(sourceType: 'article' | 'document' | 'webpage', sourceId: string) {
    const [row] = await testDb
      .select({
        generation: assistantSourceVersions.generation,
        status: assistantSourceVersions.status,
        embeddingModel: assistantSourceVersions.embeddingModel,
        degradedReason: assistantSourceVersions.degradedReason,
        chunkCount: assistantSourceVersions.chunkCount,
        versionId: assistantSourceVersions.id,
      })
      .from(assistantKnowledgeSources)
      .innerJoin(
        assistantSourceVersions,
        eq(assistantSourceVersions.id, assistantKnowledgeSources.activeVersionId)
      )
      .where(
        and(
          eq(assistantKnowledgeSources.sourceType, sourceType),
          eq(assistantKnowledgeSources.sourceId, toUuid(sourceId))
        )
      )
      .limit(1)
    return row ?? null
  }

  it('supplies a late article fact as a passage', async () => {
    const { article } = await seedArticle(longBody())
    await indexKnowledgeSource({ sourceType: 'article', sourceId: article.id })

    const items = await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['article' as const]),
    })
    const hit = items.find((item) => item.id === article.id)
    expect(hit, 'the article carrying the fact was not retrieved at all').toBeDefined()
    expect(hit!.excerpt).toContain('fourteen complimentary Zephyr passes')
    expect(hit!.headingPath).toBe('Zephyr allowance')
    expect(hit!.chunkId).toBeTruthy()
  })

  it('supplies a late document fact as a passage', async () => {
    const document = await seedDocument(longBody())
    await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })

    const items = await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['document' as const]),
    })
    const hit = items.find((item) => item.id === document.id)
    expect(hit, 'the document carrying the fact was not retrieved at all').toBeDefined()
    expect(hit!.excerpt).toContain('fourteen complimentary Zephyr passes')
  })

  it('supplies a late web page fact as a passage', async () => {
    const page = await seedWebPage(longBody())
    await indexKnowledgeSource({ sourceType: 'webpage', sourceId: page.id })

    const items = await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['webpage' as const]),
    })
    const hit = items.find((item) => item.id === page.id)
    expect(hit, 'the page carrying the fact was not retrieved at all').toBeDefined()
    expect(hit!.excerpt).toContain('fourteen complimentary Zephyr passes')
  })

  it('records the exact passage it supplied as evidence', async () => {
    const document = await seedDocument(longBody())
    await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })

    const telemetry = { embeddingModel: null, degradedReason: null, evidence: [] }
    await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['document' as const]),
      telemetry,
    })
    const evidence = telemetry.evidence.find(
      (row: { sourceId: string }) => row.sourceId === document.id
    ) as { passage: string; provenance: string; chunkId: string | null } | undefined
    expect(evidence).toBeDefined()
    expect(evidence!.passage).toContain('fourteen complimentary Zephyr passes')
    expect(evidence!.provenance).toBe('index')
    expect(evidence!.chunkId).toBeTruthy()
  })

  it('records a lexical-only turn as degraded rather than as an empty corpus', async () => {
    const telemetry = { embeddingModel: null, degradedReason: null, evidence: [] }
    await retrieveKnowledge('anything', 'public', {
      enabledSources: new Set(['document' as const]),
      telemetry,
    })
    expect(telemetry.degradedReason).toBe('embeddings_unconfigured')
  })

  it('keeps the previous generation when a refresh embeds only half the passages', async () => {
    const document = await seedDocument(longBody())
    await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })
    const first = await activeVersion('document', document.id)
    expect(first?.generation).toBe(1)
    expect(first?.degradedReason).toBe('embeddings_unavailable')

    // The refresh now has a configured model whose calls fail part way through.
    embeddingModel.mockReturnValue('text-embedding-3-small')
    let calls = 0
    generateEmbedding.mockImplementation(async () => {
      calls += 1
      return calls <= 2 ? new Array(1536).fill(0.01) : null
    })
    await testDb
      .update(assistantDocuments)
      .set({ content: `${longBody()}\n\nA revised clause about Zephyr passes.` })
      .where(eq(assistantDocuments.id, document.id))

    const outcome = await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })
    expect(outcome).toEqual({ kind: 'failed', reason: 'embedding_incomplete', retained: true })

    const still = await activeVersion('document', document.id)
    expect(still?.versionId).toBe(first?.versionId)
    expect(still?.generation).toBe(1)

    const health = await listKnowledgeSourceHealth('document', [document.id])
    expect(health.get(document.id)).toMatchObject({
      status: 'failed',
      serving: true,
      generation: 1,
      lastFailureReason: 'embedding_incomplete',
    })

    // And the retained generation still answers.
    const items = await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['document' as const]),
    })
    expect(items.some((item) => item.id === document.id)).toBe(true)
  })

  it('leaves a first-ever failure unavailable rather than half indexed', async () => {
    embeddingModel.mockReturnValue('text-embedding-3-small')
    generateEmbedding.mockResolvedValue(null)
    const document = await seedDocument(longBody())

    const outcome = await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })
    expect(outcome).toEqual({ kind: 'failed', reason: 'embedding_incomplete', retained: false })
    expect(await activeVersion('document', document.id)).toBeNull()

    const health = await listKnowledgeSourceHealth('document', [document.id])
    expect(health.get(document.id)).toMatchObject({ status: 'failed', serving: false })

    const chunks = await testDb.select({ id: assistantChunks.id }).from(assistantChunks)
    expect(chunks, 'a failed generation must leave no passages behind').toHaveLength(0)
  })

  it('excludes a revoked source before anything is reindexed', async () => {
    const { article, category } = await seedArticle(longBody())
    await indexKnowledgeSource({ sourceType: 'article', sourceId: article.id })
    expect(
      (
        await retrieveKnowledge(LATE_QUERY, 'public', {
          enabledSources: new Set(['article' as const]),
        })
      ).some((item) => item.id === article.id)
    ).toBe(true)

    // The category turns private. No index job runs.
    await testDb
      .update(helpCenterCategories)
      .set({ isPublic: false })
      .where(eq(helpCenterCategories.id, category.id))

    const after = await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['article' as const]),
    })
    expect(after.some((item) => item.id === article.id)).toBe(false)
  })

  it('excludes a source whose customer use was turned off, without reindexing', async () => {
    const document = await seedDocument(longBody())
    await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })
    await testDb
      .update(assistantDocuments)
      .set({ assistantCustomerUse: false })
      .where(eq(assistantDocuments.id, document.id))

    const customer = await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['document' as const]),
    })
    expect(customer.some((item) => item.id === document.id)).toBe(false)

    // The teammate ceiling still reaches it, flagged internal for the leak gate.
    const team = await retrieveKnowledge(LATE_QUERY, 'team', {
      enabledSources: new Set(['document' as const]),
    })
    const hit = team.find((item) => item.id === document.id)
    expect(hit).toBeDefined()
    expect(hit!.citation.internal).toBe(true)
  })

  it('excludes a soft-deleted document immediately', async () => {
    const document = await seedDocument(longBody())
    await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })
    await testDb
      .update(assistantDocuments)
      .set({ deletedAt: new Date() })
      .where(eq(assistantDocuments.id, document.id))

    const items = await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['document' as const]),
    })
    expect(items.some((item) => item.id === document.id)).toBe(false)
  })

  it('does not mix embedding generations when the model changes', async () => {
    embeddingModel.mockReturnValue('model-a')
    generateEmbedding.mockResolvedValue(new Array(1536).fill(0.02))
    const document = await seedDocument(longBody())
    await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })
    const first = await activeVersion('document', document.id)
    expect(first?.embeddingModel).toBe('model-a')

    // Same text, different model: a new generation rather than a reused one.
    embeddingModel.mockReturnValue('model-b')
    const outcome = await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })
    expect(outcome.kind).toBe('indexed')
    const second = await activeVersion('document', document.id)
    expect(second?.generation).toBe(2)
    expect(second?.embeddingModel).toBe('model-b')

    const models = await testDb
      .select({ model: assistantChunks.embeddingModel, versionId: assistantChunks.versionId })
      .from(assistantChunks)
    const active = models.filter((row) => row.versionId === second!.versionId)
    expect(active.length).toBeGreaterThan(0)
    expect(new Set(active.map((row) => row.model))).toEqual(new Set(['model-b']))
  })

  it('never answers from a generation another model embedded', async () => {
    embeddingModel.mockReturnValue('model-a')
    generateEmbedding.mockResolvedValue(new Array(1536).fill(0.02))
    const document = await seedDocument('Quokka husbandry rotas and enclosure notes.')
    await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })

    // A query sharing no lexeme with the passage, so only the vector arm can
    // answer it. Under the model that built the generation, it does.
    const control = await retrieveKnowledge('plectrum ferrule gantry', 'public', {
      enabledSources: new Set(['document' as const]),
    })
    expect(
      control.some((item) => item.id === document.id),
      'the positive control failed: the vector arm did not answer under its own model'
    ).toBe(true)

    embeddingModel.mockReturnValue('model-b')
    const crossSpace = await retrieveKnowledge('plectrum ferrule gantry', 'public', {
      enabledSources: new Set(['document' as const]),
    })
    expect(crossSpace.some((item) => item.id === document.id)).toBe(false)
  })

  it('skips a rebuild when neither the text nor the embedding space moved', async () => {
    const document = await seedDocument(longBody())
    await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })
    expect(await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })).toEqual({
      kind: 'unchanged',
    })
  })

  it('honours the requested candidate budget instead of an inner default', async () => {
    for (let i = 0; i < 7; i++) {
      const document = await seedDocument(
        `Zephyr passes allowance notes ${i}. Every workspace receives Zephyr passes.`,
        `Zephyr handbook ${i}`
      )
      await indexKnowledgeSource({ sourceType: 'document', sourceId: document.id })
    }
    const five = await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['document' as const]),
    })
    const seven = await retrieveKnowledge(LATE_QUERY, 'public', {
      enabledSources: new Set(['document' as const]),
      topK: 7,
    })
    expect(five).toHaveLength(5)
    expect(seven.length).toBeGreaterThan(5)
  })

  it('tombstones a source whose row is gone', async () => {
    const document = await seedDocument(longBody())
    const id = document.id
    await indexKnowledgeSource({ sourceType: 'document', sourceId: id })
    await testDb.delete(assistantDocuments).where(eq(assistantDocuments.id, id))

    expect(await indexKnowledgeSource({ sourceType: 'document', sourceId: id })).toEqual({
      kind: 'tombstoned',
    })
    const health = await listKnowledgeSourceHealth('document', [id])
    expect(health.has(id)).toBe(false)
  })
})
