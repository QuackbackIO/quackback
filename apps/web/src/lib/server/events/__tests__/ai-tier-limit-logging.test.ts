/**
 * A TierLimitError from a background AI hook is an expected skip (the plan has
 * no AI, or the budget is spent): it must not be logged at error level. Any
 * other failure still must be.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const h = vi.hoisted(() => ({
  generateSummary: vi.fn(),
  analyzeSentiment: vi.fn(),
  generatePostEmbedding: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/server/logger', () => ({ logger: { child: () => h.log } }))
vi.mock('@/lib/server/domains/summary/summary.service', () => ({
  generateAndSavePostSummary: (...a: unknown[]) => h.generateSummary(...a),
}))
vi.mock('@/lib/server/domains/sentiment/sentiment.service', () => ({
  analyzeSentiment: (...a: unknown[]) => h.analyzeSentiment(...a),
  saveSentiment: vi.fn(),
}))
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generatePostEmbedding: (...a: unknown[]) => h.generatePostEmbedding(...a),
}))
vi.mock('../hook-idempotency', () => ({
  claimHookDelivery: async () => true,
  releaseHookDelivery: async () => undefined,
  completeHookDelivery: async () => undefined,
  failHookDelivery: async () => undefined,
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
      })),
    })),
  },
  eq: vi.fn(),
}))

import { summaryHook } from '../handlers/summary'
import { aiHook } from '../handlers/ai'

const tierLimit = () =>
  new TierLimitError({
    limit: 'aiTokensPerMonth',
    current: 0,
    max: 0,
    message: 'AI features are not included on your plan. Upgrade to enable them.',
  })

const event = {
  id: 'evt_1',
  type: 'post.created',
  timestamp: '2026-01-01T00:00:00Z',
  actor: { type: 'user' },
  data: { post: { id: 'post_1', title: 'T', content: 'C' } },
} as never

describe('summary hook', () => {
  beforeEach(() => vi.clearAllMocks())

  it('logs a TierLimitError below error level', async () => {
    h.generateSummary.mockRejectedValue(tierLimit())
    const res = await summaryHook.run(event, {}, {})
    expect(res).toEqual({ success: true })
    expect(h.log.error).not.toHaveBeenCalled()
    expect(h.log.info).toHaveBeenCalledTimes(1)
  })

  it('still logs other errors at error', async () => {
    h.generateSummary.mockRejectedValue(new Error('boom'))
    await summaryHook.run(event, {}, {})
    expect(h.log.error).toHaveBeenCalledTimes(1)
  })
})

describe('ai hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.analyzeSentiment.mockResolvedValue(null)
    h.generatePostEmbedding.mockResolvedValue(true)
  })

  it('logs a sentiment TierLimitError below error level', async () => {
    h.analyzeSentiment.mockRejectedValue(tierLimit())
    await aiHook.run(event, {}, {})
    expect(h.log.error).not.toHaveBeenCalled()
  })

  it('still logs another sentiment error at error', async () => {
    h.analyzeSentiment.mockRejectedValue(new Error('boom'))
    await aiHook.run(event, {}, {})
    expect(h.log.error).toHaveBeenCalledTimes(1)
  })
})
