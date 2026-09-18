import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantDocuments,
  assistantWebSources,
  helpCenterArticles,
  helpCenterCategories,
  principal,
  eq,
  sql,
} from '@/lib/server/db'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'
import { getCustomerCitationSource } from '../public-source'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const embedding = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: embedding,
}))
import { documentsKnowledgeSource } from '../documents-retrieval'
import { webpageKnowledgeSource } from '../web-sources-retrieval'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ use: assistantDocuments.assistantCustomerUse })
      .from(assistantDocuments)
      .limit(0)
  },
})
describe.skipIf(!fixture.available)('source-use retrieval boundaries (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    embedding.mockResolvedValue(null)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('rechecks old article citations against use, publication and visibility', async () => {
    const [author] = await testDb
      .insert(principal)
      .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
      .returning()
    const [category] = await testDb
      .insert(helpCenterCategories)
      .values({ name: 'Citation test', slug: 'quinn-citation-test' })
      .returning()
    const [article] = await testDb
      .insert(helpCenterArticles)
      .values({
        categoryId: category.id,
        principalId: author.id,
        title: 'Public source',
        slug: 'quinn-citation-test',
        content: 'Current public content',
        publishedAt: new Date(),
      })
      .returning()
    const knowledge = { ...DEFAULT_ASSISTANT_CONFIG.agents.agent.knowledge, helpCenter: true }
    const read = () => getCustomerCitationSource('article', article.id, knowledge)
    expect(await read()).toEqual({ title: 'Public source', content: 'Current public content' })
    await testDb
      .update(helpCenterArticles)
      .set({ assistantCustomerUse: false })
      .where(eq(helpCenterArticles.id, article.id))
    expect(await read()).toBeNull()
    await testDb
      .update(helpCenterArticles)
      .set({ assistantCustomerUse: true })
      .where(eq(helpCenterArticles.id, article.id))
    expect(
      await getCustomerCitationSource('article', article.id, { ...knowledge, helpCenter: false })
    ).toBeNull()
    await testDb
      .update(helpCenterCategories)
      .set({ isPublic: false })
      .where(eq(helpCenterCategories.id, category.id))
    expect(await read()).toBeNull()
    await testDb
      .update(helpCenterCategories)
      .set({ isPublic: true, segmentIds: ['restricted'] })
      .where(eq(helpCenterCategories.id, category.id))
    expect(await read()).toBeNull()
    await testDb
      .update(helpCenterCategories)
      .set({ segmentIds: [] })
      .where(eq(helpCenterCategories.id, category.id))
    await testDb
      .update(helpCenterArticles)
      .set({ publishedAt: null })
      .where(eq(helpCenterArticles.id, article.id))
    expect(await read()).toBeNull()
  })

  it('rejects invalid source identities and unsupported customer source types', async () => {
    const knowledge = DEFAULT_ASSISTANT_CONFIG.agents.agent.knowledge
    expect(await getCustomerCitationSource('article', 'not-an-id', knowledge)).toBeNull()
    expect(await getCustomerCitationSource('ticket', 'not-an-id', knowledge)).toBeNull()
  })

  it.each([false, true])(
    'filters both document uses before ranking, semantic=%s',
    async (semantic) => {
      const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))
      embedding.mockResolvedValue(semantic ? vector : null)
      const rows = await testDb
        .insert(assistantDocuments)
        .values([
          {
            title: 'quinnuseprobe customer',
            content: 'quinnuseprobe',
            fileName: 'c.pdf',
            mimeType: 'application/pdf',
            assistantTeamUse: false,
            embedding: sql`${JSON.stringify(vector)}::vector`,
          },
          {
            title: 'quinnuseprobe team',
            content: 'quinnuseprobe',
            fileName: 't.pdf',
            mimeType: 'application/pdf',
            assistantCustomerUse: false,
            embedding: sql`${JSON.stringify(vector)}::vector`,
          },
          {
            title: 'quinnuseprobe excluded',
            content: 'quinnuseprobe',
            fileName: 'x.pdf',
            mimeType: 'application/pdf',
            assistantCustomerUse: false,
            assistantTeamUse: false,
            embedding: sql`${JSON.stringify(vector)}::vector`,
          },
          {
            title: 'quinnuseprobe deleted',
            content: 'quinnuseprobe',
            fileName: 'd.pdf',
            mimeType: 'application/pdf',
            deletedAt: new Date(),
            embedding: sql`${JSON.stringify(vector)}::vector`,
          },
        ])
        .returning()
      const customer = await documentsKnowledgeSource.retrieve('quinnuseprobe', 'public', {
        topK: 20,
      })
      const team = await documentsKnowledgeSource.retrieve('quinnuseprobe', 'team', { topK: 20 })
      expect(customer.map((r) => r.id)).toEqual([rows[0].id])
      expect(team.map((r) => r.id)).toEqual([rows[1].id])
      expect(team[0].citation.internal).toBe(true)
    }
  )

  it('filters web pages independently per use and retains the enabled boundary', async () => {
    const rows = await testDb
      .insert(assistantWebSources)
      .values([
        {
          url: 'https://example.com/quinnuseprobe-c',
          title: 'quinnuseprobe',
          content: 'quinnuseprobe',
          fetchedAt: new Date(),
          assistantTeamUse: false,
        },
        {
          url: 'https://example.com/quinnuseprobe-t',
          title: 'quinnuseprobe',
          content: 'quinnuseprobe',
          fetchedAt: new Date(),
          assistantCustomerUse: false,
        },
        {
          url: 'https://example.com/quinnuseprobe-disabled',
          title: 'quinnuseprobe',
          content: 'quinnuseprobe',
          fetchedAt: new Date(),
          enabled: false,
        },
      ])
      .returning()
    const customer = await webpageKnowledgeSource.retrieve('quinnuseprobe', 'public', { topK: 20 })
    const team = await webpageKnowledgeSource.retrieve('quinnuseprobe', 'team', { topK: 20 })
    expect(customer.map((r) => r.id)).toEqual([rows[0].id])
    expect(team.map((r) => r.id)).toEqual([rows[1].id])
    expect(team[0].citation.internal).toBe(true)
  })
})
