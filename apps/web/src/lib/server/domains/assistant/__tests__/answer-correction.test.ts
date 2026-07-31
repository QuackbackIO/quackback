/**
 * Real-DB coverage for the answer-correction loop: a teammate marks a Quinn
 * answer unhelpful and attaches the ideal answer; the service must append an
 * `assistant_events` row (the outcome signal) AND persist the correction as a
 * snippet so `retrieveSnippets` surfaces it for a future similar question —
 * the correction rides the existing snippet pipeline, not a new store.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantEvents, assistantSnippets, conversations, eq, principal } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'

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

import { recordAnswerCorrection } from '../answer-correction'
import { retrieveSnippets } from '../snippets-retrieval'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantEvents.id }).from(assistantEvents).limit(0)
    await db.select({ id: assistantSnippets.id }).from(assistantSnippets).limit(0)
  },
})

/** The embedding column is a fixed pgvector(1536); pad a short seed vector out
 *  to that width so real-DB writes don't fail the dimension check. */
function fakeVector(seed = 0.1): number[] {
  return Array.from({ length: 1536 }, () => seed)
}

describe.skipIf(!fixture.available)('answer-correction (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
    mockGenerateEmbedding.mockResolvedValue(fakeVector())
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('appends an assistant_events feedback row and creates a snippet from the correction', async () => {
    const result = await recordAnswerCorrection({
      question: 'How do I reset my API key?',
      idealAnswer: 'Go to Settings → Developers and rotate the key there.',
      reason: 'Answer pointed at the wrong settings page',
    })

    const events = await testDb.select().from(assistantEvents)
    expect(events).toHaveLength(1)
    expect(events[0]!.eventType).toBe('answer_correction')
    expect(events[0]!.metadata).toMatchObject({
      rating: 'down',
      reason: 'Answer pointed at the wrong settings page',
      snippetId: result.snippet.id,
    })

    const snippets = await testDb.select().from(assistantSnippets)
    expect(snippets).toHaveLength(1)
    expect(snippets[0]!.id).toBe(result.snippet.id)
    expect(snippets[0]!.content).toBe('Go to Settings → Developers and rotate the key there.')
    expect(snippets[0]!.enabled).toBe(true)
  })

  it('makes the correction retrievable for a future similar question', async () => {
    await recordAnswerCorrection({
      question: 'How do I reset my API key?',
      idealAnswer: 'Go to Settings → Developers and rotate the key there.',
    })

    // Same embedding for every query in this fixture: a semantic hit is a
    // stand-in for "a future similar question".
    const hits = await retrieveSnippets('Where can I rotate my API credentials?', 'team')
    expect(hits.map((h) => h.content)).toContain(
      'Go to Settings → Developers and rotate the key there.'
    )
  })

  it('falls back to keyword retrieval when no embedding provider is configured', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    await recordAnswerCorrection({
      question: 'Do you offer SSO?',
      idealAnswer: 'Yes — SAML and OIDC are available on every plan.',
    })

    const hits = await retrieveSnippets('SSO', 'team')
    expect(hits.map((h) => h.content)).toContain('Yes — SAML and OIDC are available on every plan.')
  })

  it('truncates an over-long question into the snippet title budget', async () => {
    const result = await recordAnswerCorrection({
      question: 'x'.repeat(200),
      idealAnswer: 'The corrected answer.',
    })
    expect(result.snippet.title.length).toBeLessThanOrEqual(120)
  })

  it('rejects an empty ideal answer', async () => {
    await expect(
      recordAnswerCorrection({ question: 'Anything?', idealAnswer: '   ' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('links the event to the conversation the answer belonged to', async () => {
    const [visitor] = await testDb
      .insert(principal)
      .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
      .returning()
    const [conversation] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: visitor.id, channel: 'messenger' })
      .returning()

    const result = await recordAnswerCorrection({
      question: 'q',
      idealAnswer: 'a',
      conversationId: conversation.id as ConversationId,
    })
    const [event] = await testDb
      .select()
      .from(assistantEvents)
      .where(eq(assistantEvents.id, result.eventId))
    expect(event!.conversationId).toBe(conversation.id)
  })
})
