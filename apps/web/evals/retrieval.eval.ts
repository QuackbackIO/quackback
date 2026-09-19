/**
 * Retrieval regression suite (QUINN-PRODUCT P5/P6, specification §12).
 *
 * The second of the three suites the specification asks for, and the one that
 * needs no provider at all: representative questions over seeded passages with
 * known source permissions, comparing coverage, ranking, late-document facts,
 * a non-English passage and degraded embeddings.
 *
 * Structural by construction. The embedding service is stubbed to unavailable,
 * so every generation is lexical and every assertion is about which passage the
 * retrieval layer supplies rather than about a similarity score a fake could
 * make say anything. That also means this file is free to run and deterministic,
 * which is what a regression suite has to be: the golden answer-quality set
 * (scenarios.eval.ts) is where a real model belongs.
 *
 * Run it from the repo root against a migrated disposable database:
 *   DATABASE_URL=... bun vitest run --config apps/web/evals/vitest.config.ts \
 *     apps/web/evals/retrieval.eval.ts
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

// Rebind the global db to the rollback transaction (README pattern #1).
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// No provider, deliberately: see the module doc.
vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: () => null,
  getChatModel: () => null,
  isVisionCapableModel: () => false,
}))
vi.mock('@/lib/server/domains/embeddings/embedding.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/embeddings/embedding.service')>()),
  generateEmbedding: async () => null,
}))
vi.mock('@/lib/server/domains/help-center/help-center-embedding.service', async (orig) => ({
  ...(await orig<
    typeof import('@/lib/server/domains/help-center/help-center-embedding.service')
  >()),
  generateKbQueryEmbedding: async () => null,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantChunks,
  assistantDocuments,
  assistantWebSources,
  helpCenterArticles,
  helpCenterCategories,
  principal,
  eq,
} from '@/lib/server/db'
import {
  retrieveKnowledge,
  type RetrievalTelemetry,
} from '@/lib/server/domains/assistant/retrieval-sources'
import { indexKnowledgeSource } from '@/lib/server/domains/assistant/knowledge-index.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantChunks.id }).from(assistantChunks).limit(0)
  },
})

/** Filler that shares no lexeme with any question below. */
const FILLER = 'Onboarding checklist step. '.repeat(400)

interface SeededCase {
  /** Stable name, so a regression names the case rather than an index. */
  name: string
  question: string
  /** The document title the question should retrieve. */
  expect: string
  /** A phrase the supplied passage must contain, for a coverage assertion. */
  phrase: string
}

/** Representative questions and the passage each one must reach. */
const CASES: SeededCase[] = [
  {
    name: 'late fact past the old prefix window',
    question: 'Zephyr passes allowance',
    expect: 'Onboarding handbook',
    phrase: 'fourteen complimentary Zephyr passes',
  },
  {
    name: 'a fact in a short source',
    question: 'quibble escalation window',
    expect: 'Escalation rota',
    phrase: 'quibble escalations are answered within four hours',
  },
  {
    name: 'a non-English passage reached by its distinctive term',
    question: 'Zahlungsfrist',
    expect: 'Zahlungsbedingungen',
    phrase: 'Die Zahlungsfrist betraegt dreissig Tage',
  },
]

const SOURCES: Array<{ title: string; body: string }> = [
  {
    title: 'Onboarding handbook',
    body: `${FILLER}\n\n## Zephyr allowance\nEvery Zephyr workspace receives fourteen complimentary Zephyr passes.\n`,
  },
  {
    title: 'Escalation rota',
    body: '## Escalation\nUrgent quibble escalations are answered within four hours on business days.',
  },
  {
    title: 'Zahlungsbedingungen',
    body: '## Zahlungsfrist\nDie Zahlungsfrist betraegt dreissig Tage ab Rechnungsdatum.',
  },
  {
    title: 'Unrelated rota',
    body: '## Quokka husbandry\nEnclosure notes and feeding rotas for the visitor centre.',
  },
]

describe.skipIf(!fixture.available)('retrieval regression over seeded passages', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function seedDocuments(): Promise<Map<string, string>> {
    const ids = new Map<string, string>()
    for (const source of SOURCES) {
      const [row] = await testDb
        .insert(assistantDocuments)
        .values({
          title: source.title,
          fileName: `${source.title}.pdf`,
          mimeType: 'application/pdf',
          content: source.body,
        })
        .returning()
      await indexKnowledgeSource({ sourceType: 'document', sourceId: row.id })
      ids.set(source.title, row.id)
    }
    return ids
  }

  it('covers every representative question and ranks its source first', async () => {
    const ids = await seedDocuments()
    const misses: string[] = []
    const misranked: string[] = []
    const uncovered: string[] = []

    for (const testCase of CASES) {
      const items = await retrieveKnowledge(testCase.question, 'public', {
        enabledSources: new Set(['document' as const]),
      })
      const expectedId = ids.get(testCase.expect)!
      const hit = items.find((item) => item.id === expectedId)
      if (!hit) {
        misses.push(testCase.name)
        continue
      }
      if (items[0]?.id !== expectedId) misranked.push(testCase.name)
      if (!hit.excerpt.includes(testCase.phrase)) uncovered.push(testCase.name)
    }

    expect({ misses, misranked, uncovered }).toEqual({
      misses: [],
      misranked: [],
      uncovered: [],
    })
  })

  it('supplies the passage rather than the head of the source', async () => {
    const ids = await seedDocuments()
    const items = await retrieveKnowledge('Zephyr passes allowance', 'public', {
      enabledSources: new Set(['document' as const]),
    })
    const hit = items.find((item) => item.id === ids.get('Onboarding handbook'))!
    // The passage, not a 1,200 character prefix of a 10,000 character document.
    expect(hit.excerpt).toContain('fourteen complimentary Zephyr passes')
    expect(hit.excerpt.length).toBeLessThan(2_000)
    expect(hit.chunkId).toBeTruthy()
    expect(hit.sourceVersion).toMatch(/^1:/)
  })

  it('records the lexical-only run as degraded rather than as a thin corpus', async () => {
    await seedDocuments()
    const telemetry: RetrievalTelemetry = {
      embeddingModel: null,
      degradedReason: null,
      evidence: [],
    }
    const items = await retrieveKnowledge('Zephyr passes allowance', 'public', {
      enabledSources: new Set(['document' as const]),
      telemetry,
    })
    expect(items.length).toBeGreaterThan(0)
    expect(telemetry.degradedReason).toBe('embeddings_unconfigured')
    expect(telemetry.embeddingModel).toBeNull()
    expect(telemetry.evidence[0]).toMatchObject({ provenance: 'index', audience: 'public' })
  })

  it('keeps an excluded source out of a customer turn and internal for a teammate', async () => {
    const ids = await seedDocuments()
    await testDb
      .update(assistantDocuments)
      .set({ assistantCustomerUse: false })
      .where(eq(assistantDocuments.id, ids.get('Escalation rota') as never))

    const customer = await retrieveKnowledge('quibble escalation window', 'public', {
      enabledSources: new Set(['document' as const]),
    })
    expect(customer.some((item) => item.id === ids.get('Escalation rota'))).toBe(false)

    const team = await retrieveKnowledge('quibble escalation window', 'team', {
      enabledSources: new Set(['document' as const]),
    })
    const hit = team.find((item) => item.id === ids.get('Escalation rota'))
    expect(hit?.citation.internal).toBe(true)
  })

  it('never retrieves a private article for a customer, indexed or not', async () => {
    const [author] = await testDb
      .insert(principal)
      .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
      .returning()
    const [category] = await testDb
      .insert(helpCenterCategories)
      .values({ name: 'Internal', slug: 'quinn-eval-internal', isPublic: false })
      .returning()
    const [article] = await testDb
      .insert(helpCenterArticles)
      .values({
        categoryId: category.id,
        principalId: author.id,
        title: 'Internal escalation rota',
        slug: 'quinn-eval-internal-rota',
        content: '## Escalation\nUrgent quibble escalations page the duty engineer.',
        publishedAt: new Date(),
      })
      .returning()
    await indexKnowledgeSource({ sourceType: 'article', sourceId: article.id })

    const customer = await retrieveKnowledge('quibble escalation window', 'public', {
      enabledSources: new Set(['article' as const]),
    })
    expect(customer.some((item) => item.id === article.id)).toBe(false)
  })

  it('honours the requested candidate budget across the corpus', async () => {
    const [author] = await testDb
      .insert(principal)
      .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
      .returning()
    const [category] = await testDb
      .insert(helpCenterCategories)
      .values({ name: 'Public', slug: 'quinn-eval-public', isPublic: true })
      .returning()
    for (let i = 0; i < 7; i++) {
      const [article] = await testDb
        .insert(helpCenterArticles)
        .values({
          categoryId: category.id,
          principalId: author.id,
          title: `Zephyr passes ${i}`,
          slug: `quinn-eval-zephyr-${i}`,
          content: `## Zephyr allowance ${i}\nEvery workspace receives Zephyr passes.`,
          publishedAt: new Date(),
        })
        .returning()
      await indexKnowledgeSource({ sourceType: 'article', sourceId: article.id })
    }
    const five = await retrieveKnowledge('Zephyr passes allowance', 'public', {
      enabledSources: new Set(['article' as const]),
    })
    const seven = await retrieveKnowledge('Zephyr passes allowance', 'public', {
      enabledSources: new Set(['article' as const]),
      topK: 7,
    })
    expect(five).toHaveLength(5)
    expect(seven).toHaveLength(7)
  })

  it('drops a web page from retrieval the moment it is disabled', async () => {
    const [page] = await testDb
      .insert(assistantWebSources)
      .values({
        url: 'https://example.test/quinn-eval-zephyr',
        title: 'Zephyr allowance page',
        content: '## Zephyr allowance\nEvery workspace receives Zephyr passes.',
        fetchedAt: new Date(),
      })
      .returning()
    await indexKnowledgeSource({ sourceType: 'webpage', sourceId: page.id })
    expect(
      (
        await retrieveKnowledge('Zephyr passes allowance', 'public', {
          enabledSources: new Set(['webpage' as const]),
        })
      ).some((item) => item.id === page.id)
    ).toBe(true)

    await testDb
      .update(assistantWebSources)
      .set({ enabled: false })
      .where(eq(assistantWebSources.id, page.id))
    expect(
      (
        await retrieveKnowledge('Zephyr passes allowance', 'public', {
          enabledSources: new Set(['webpage' as const]),
        })
      ).some((item) => item.id === page.id)
    ).toBe(false)
  })
})
