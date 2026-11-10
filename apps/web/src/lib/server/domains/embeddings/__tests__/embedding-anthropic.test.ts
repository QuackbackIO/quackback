// @vitest-environment node
/**
 * The Claude API has no embeddings endpoint. With ANTHROPIC_API_KEY as the
 * active provider every embedding entry point returns "no embedding" without
 * building a client or touching the network, even when AI_EMBEDDING_MODEL and
 * OPENAI_BASE_URL are still set, so the callers take their keyword paths
 * (their own tests cover those paths given a null embedding).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  openaiConstructed: 0,
  isTestPost: vi.fn(async () => false),
  cfg: {
    anthropicApiKey: 'sk-ant' as string | undefined,
    openaiApiKey: undefined as string | undefined,
    openaiBaseUrl: 'https://openrouter.ai/api/v1' as string | undefined,
    aiEmbeddingModel: 'openai/text-embedding-3-small' as string | undefined,
  },
}))

vi.mock('openai', () => ({
  default: class {
    constructor() {
      hoisted.openaiConstructed++
    }
  },
}))
vi.mock('@/lib/server/config', () => ({ config: hoisted.cfg }))
vi.mock('@/lib/server/test-data', () => ({ isTestPost: hoisted.isTestPost }))
vi.mock('@/lib/server/logger', () => {
  const log = { info: () => {}, warn: () => {}, error: vi.fn(), debug: () => {}, child: () => log }
  return { logger: log }
})

import { generateEmbedding, generatePostEmbedding } from '../embedding.service'
import { generateKbEmbedding } from '@/lib/server/domains/help-center/help-center-embedding.service'
import { getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { logger } from '@/lib/server/logger'
import type { PostId } from '@quackback/ids'

beforeEach(() => {
  hoisted.openaiConstructed = 0
  hoisted.isTestPost.mockClear()
  vi.mocked(logger.error).mockClear()
})

describe('embeddings on the Claude API', () => {
  it('has no embedding model', () => {
    expect(getEmbeddingModel()).toBeNull()
  })

  it('returns no query embedding and builds no client', async () => {
    expect(await generateEmbedding('dark mode')).toBeNull()
    expect(await generateKbEmbedding('dark mode')).toBeNull()
    expect(hoisted.openaiConstructed).toBe(0)
  })

  it('skips post embeddings quietly instead of logging a failure', async () => {
    expect(await generatePostEmbedding('post_1' as PostId, 'Dark mode', 'Please')).toBe(false)
    expect(hoisted.isTestPost).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })
})
