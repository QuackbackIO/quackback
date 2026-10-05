/**
 * Every embedding call is recorded in ai_usage_log and counts toward the AI
 * allowance, including calls made without a log context (search-as-you-type
 * and similar-post lookups). A provider that returns no usage block still
 * gets a row, with tokens estimated from the input length.
 *
 * Real provider client, real usage logging and counter against the test
 * database (rolled back), with a local server standing in for the provider.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { aiUsageLog, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const provider = vi.hoisted(() => ({
  baseUrl: '',
  usage: { prompt_tokens: 7, total_tokens: 7 } as Record<string, number> | null,
}))
vi.mock('@/lib/server/config', () => ({
  config: {
    openaiApiKey: 'test-key',
    get openaiBaseUrl() {
      return provider.baseUrl
    },
  },
}))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: () => 'test-embedding-model',
}))

import { generateEmbedding } from '../embedding.service'
import { generateKbEmbedding } from '@/lib/server/domains/help-center/help-center-embedding.service'
import { aiTokensInWindow } from '@/lib/server/domains/ai/usage-counter'

const fixture = await createDbTestFixture({
  probe: async (db) => void (await db.select({ id: aiUsageLog.id }).from(aiUsageLog).limit(0)),
})
afterAll(() => fixture.close())

/** Rows written by the code under test; logging is fire-and-forget, so poll briefly. */
async function embeddingRows(step: string) {
  for (let i = 0; i < 50; i++) {
    const rows = await testDb.select().from(aiUsageLog).where(eq(aiUsageLog.pipelineStep, step))
    if (rows.length > 0) return rows
    await new Promise((r) => setTimeout(r, 10))
  }
  return []
}

describe.skipIf(!fixture.available)('embedding usage accounting', () => {
  // One server for the file: the provider client is cached per process, so
  // it keeps the first base URL it saw.
  let server: Server

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            object: 'list',
            data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
            model: 'test-embedding-model',
            ...(provider.usage ? { usage: provider.usage } : {}),
          })
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    provider.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(async () => {
    await fixture.begin()
    provider.usage = { prompt_tokens: 7, total_tokens: 7 }
  })

  afterEach(async () => {
    await fixture.rollback()
  })

  it('records a call made without a log context under its own step', async () => {
    expect(await generateEmbedding('dark mode please')).toEqual([0.1, 0.2])
    const rows = await embeddingRows('embedding_query')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ callType: 'embedding', totalTokens: 7, status: 'success' })
  })

  it('estimates tokens from the input when the provider reports no usage', async () => {
    provider.usage = null
    const text = 'x'.repeat(400)
    await generateEmbedding(text)
    const [row] = await embeddingRows('embedding_query')
    expect(row?.totalTokens).toBe(100)
    expect(row?.inputTokens).toBe(100)
  })

  it('estimates help center embeddings the same way', async () => {
    provider.usage = null
    await generateKbEmbedding('y'.repeat(80), { pipelineStep: 'kb_search_query_embedding' })
    const [row] = await embeddingRows('kb_search_query_embedding')
    expect(row?.totalTokens).toBe(20)
  })

  it('records embedding tokens without counting them toward the allowance', async () => {
    const before = await aiTokensInWindow(
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000)
    )
    await generateEmbedding('count me')
    const rows = await embeddingRows('embedding_query')
    expect(rows.length).toBeGreaterThan(0)
    const after = await aiTokensInWindow(
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000)
    )
    expect(after - before).toBe(0)
  })
})
