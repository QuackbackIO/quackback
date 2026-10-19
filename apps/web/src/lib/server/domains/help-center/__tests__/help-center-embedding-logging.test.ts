import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEmbeddingsCreate = vi.fn()
const mockWithUsageLogging = vi.fn()

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => ({ embeddings: { create: mockEmbeddingsCreate } })),
}))

vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: vi.fn(() => 'text-embedding-3-small'),
}))

vi.mock('@/lib/server/domains/ai/usage-log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/ai/usage-log')>()),
  withUsageLogging: (...args: unknown[]) => mockWithUsageLogging(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {},
  helpCenterArticles: {},
  eq: vi.fn(),
  sql: vi.fn(),
}))

import {
  generateHelpCenterEmbedding,
  generateHelpCenterQueryEmbedding,
  clearQueryEmbeddingCache,
} from '../help-center-embedding.service'

beforeEach(() => {
  vi.clearAllMocks()
  // Pass through: run the wrapped call and extract usage like the real helper.
  mockWithUsageLogging.mockImplementation(
    async (
      _params: unknown,
      fn: () => Promise<{ result: unknown; retryCount: number }>,
      extract: (result: unknown) => unknown
    ) => {
      const { result } = await fn()
      extract(result)
      return result
    }
  )
  mockEmbeddingsCreate.mockResolvedValue({
    data: [{ embedding: [0.1, 0.2] }],
    usage: { prompt_tokens: 7, total_tokens: 7 },
  })
})

describe('generateHelpCenterEmbedding usage logging', () => {
  it('routes the embedding call through withUsageLogging with the given context', async () => {
    const result = await generateHelpCenterEmbedding('some text', {
      pipelineStep: 'help_center_article_embedding',
      metadata: { articleId: 'article_1' },
    })

    expect(result).toEqual([0.1, 0.2])
    expect(mockWithUsageLogging).toHaveBeenCalledOnce()
    const [params] = mockWithUsageLogging.mock.calls[0]
    expect(params).toMatchObject({
      pipelineStep: 'help_center_article_embedding',
      callType: 'embedding',
      model: 'text-embedding-3-small',
      metadata: { articleId: 'article_1' },
    })
  })

  it('defaults the pipeline step when no context is given', async () => {
    await generateHelpCenterEmbedding('some text')
    const [params] = mockWithUsageLogging.mock.calls[0]
    expect(params).toMatchObject({ pipelineStep: 'help_center_embedding', callType: 'embedding' })
  })

  it('extracts token usage from the embeddings response', async () => {
    let extracted: unknown
    mockWithUsageLogging.mockImplementation(
      async (
        _params: unknown,
        fn: () => Promise<{ result: unknown; retryCount: number }>,
        extract: (result: unknown) => unknown
      ) => {
        const { result } = await fn()
        extracted = extract(result)
        return result
      }
    )

    await generateHelpCenterEmbedding('some text')
    expect(extracted).toEqual({ inputTokens: 7, totalTokens: 7 })
  })

  it('still returns null on API failure', async () => {
    mockWithUsageLogging.mockRejectedValue(new Error('boom'))
    const result = await generateHelpCenterEmbedding('some text')
    expect(result).toBeNull()
  })
})

describe('generateHelpCenterQueryEmbedding cache', () => {
  beforeEach(() => clearQueryEmbeddingCache())

  it('serves repeats from cache without a second provider call', async () => {
    const a = await generateHelpCenterQueryEmbedding('how do I vote')
    const b = await generateHelpCenterQueryEmbedding('how do I vote')
    expect(a).toEqual([0.1, 0.2])
    expect(b).toEqual([0.1, 0.2])
    expect(mockWithUsageLogging).toHaveBeenCalledOnce()
  })

  it('misses on different query text', async () => {
    await generateHelpCenterQueryEmbedding('how do I vote')
    await generateHelpCenterQueryEmbedding('how do I comment')
    expect(mockWithUsageLogging).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures', async () => {
    mockWithUsageLogging.mockRejectedValueOnce(new Error('boom'))
    expect(await generateHelpCenterQueryEmbedding('flaky query')).toBeNull()
    // Second call retries the provider instead of returning a cached null.
    expect(await generateHelpCenterQueryEmbedding('flaky query')).toEqual([0.1, 0.2])
    expect(mockWithUsageLogging).toHaveBeenCalledTimes(2)
  })
})
