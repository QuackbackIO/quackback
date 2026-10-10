/**
 * generateEmbedding hands its caller's abort signal to the provider request,
 * so a job past its deadline does not leave the request running. Real
 * provider client, real retry and usage logging (rolled back), against a local
 * server that accepts the request and never answers.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const provider = vi.hoisted(() => ({ baseUrl: '' }))
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

const fixture = await createDbTestFixture()
afterAll(() => fixture.close())

describe.skipIf(!fixture.available)('generateEmbedding and its abort signal', () => {
  let server: Server
  let received: () => void
  let requested: Promise<void>

  beforeEach(async () => {
    requested = new Promise((resolve) => (received = resolve))
    // Accepts the request and never answers, as a stalled provider does.
    server = createServer(() => received())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    provider.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    await fixture.begin()
  })
  afterEach(async () => {
    await fixture.rollback()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it('cancels the provider request when the signal aborts, and returns null', async () => {
    const deadline = new AbortController()
    const run = generateEmbedding(
      'Customer was double-charged; refunded.',
      { pipelineStep: 'assistant_summary_embedding' },
      { signal: deadline.signal }
    )
    await requested
    deadline.abort(new Error('event reactions passed their deadline'))

    await expect(run).resolves.toBeNull()
  }, 5_000)
})
