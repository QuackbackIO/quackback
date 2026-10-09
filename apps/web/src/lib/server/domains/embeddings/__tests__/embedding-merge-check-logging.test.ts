/**
 * The fire-and-forget merge check that follows a fresh post embedding is
 * refused when the plan has no AI. That refusal is an expected skip and must
 * not be logged at error; any other failure still must be.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId } from '@quackback/ids'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const h = vi.hoisted(() => ({
  checkPost: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/server/logger', () => ({ logger: { child: () => h.log } }))
vi.mock('@/lib/server/domains/merge-suggestions/merge-check.service', () => ({
  checkPostForMergeCandidates: (...a: unknown[]) => h.checkPost(...a),
}))
vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: () => ({
    embeddings: { create: async () => ({ data: [{ embedding: [0.1, 0.2] }] }) },
  }),
}))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: () => 'test-embedding-model',
}))
vi.mock('@/lib/server/domains/ai/retry', () => ({
  withRetry: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  embeddingUsage: vi.fn(),
  withUsageLogging: (_ctx: unknown, fn: () => unknown) => fn(),
}))
// A real post, not a test customer's: test posts are never embedded.
vi.mock('@/lib/server/test-data', () => ({ isTestPost: async () => false }))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
  },
}))

import { generatePostEmbedding } from '../embedding.service'

/** The merge check is fire-and-forget; let its rejection handler run. */
const flush = () => new Promise((r) => setTimeout(r, 20))

describe('generatePostEmbedding merge-check failure logging', () => {
  beforeEach(() => vi.clearAllMocks())

  it('logs a TierLimitError below error level', async () => {
    h.checkPost.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', current: 0, max: 0, message: 'no AI' })
    )
    expect(await generatePostEmbedding('post_1' as PostId, 't', 'c')).toBe(true)
    await flush()
    expect(h.checkPost).toHaveBeenCalled()
    expect(h.log.error).not.toHaveBeenCalled()
    expect(h.log.info).toHaveBeenCalledTimes(1)
  })

  it('still logs other errors at error', async () => {
    h.checkPost.mockRejectedValue(new Error('boom'))
    await generatePostEmbedding('post_1' as PostId, 't', 'c')
    await flush()
    expect(h.log.error).toHaveBeenCalledTimes(1)
  })
})
