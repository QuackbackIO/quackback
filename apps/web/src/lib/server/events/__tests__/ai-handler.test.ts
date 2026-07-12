/**
 * AI Handler Unit Tests
 *
 * Covers the idempotency lease outcomes around post.created sentiment +
 * embedding processing: complete-on-success, release-on-retryable-failure,
 * fail-on-terminal-failure, and the duplicate-delivery skip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  claim: vi.fn(async () => true),
  release: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
  fail: vi.fn(async () => undefined),
  analyzeSentiment: vi.fn(),
  saveSentiment: vi.fn(async (..._args: unknown[]) => undefined),
  generatePostEmbedding: vi.fn(),
}))

vi.mock('../hook-idempotency', () => ({
  claimHookDelivery: () => h.claim(),
  releaseHookDelivery: () => h.release(),
  completeHookDelivery: () => h.complete(),
  failHookDelivery: () => h.fail(),
}))

vi.mock('@/lib/server/domains/sentiment/sentiment.service', () => ({
  analyzeSentiment: (...a: unknown[]) => h.analyzeSentiment(...a),
  saveSentiment: (...a: unknown[]) => h.saveSentiment(...a),
}))

vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generatePostEmbedding: (...a: unknown[]) => h.generatePostEmbedding(...a),
}))

// Spread the real db module so tables/operators stay current; the tag
// lookup this handler does is unrelated to the idempotency behavior under
// test, so give it a query builder that resolves an empty tag list.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  },
  eq: vi.fn(),
}))

import { aiHook } from '../handlers/ai'

describe('AI Handler', () => {
  const event = {
    id: 'evt_1',
    type: 'post.created',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user' },
    data: { post: { id: 'post_1', title: 'Title', content: 'Content' } },
  } as never

  beforeEach(() => {
    vi.clearAllMocks()
    h.claim.mockResolvedValue(true)
    h.analyzeSentiment.mockResolvedValue({ sentiment: 'positive', score: 0.9 })
    h.generatePostEmbedding.mockResolvedValue(true)
  })

  it('skips processing entirely when the claim is already held (duplicate re-run)', async () => {
    h.claim.mockResolvedValue(false)
    const res = await aiHook.run(event, { type: 'ai' }, {})
    expect(res).toEqual({ success: true })
    expect(h.analyzeSentiment).not.toHaveBeenCalled()
    expect(h.generatePostEmbedding).not.toHaveBeenCalled()
    expect(h.complete).not.toHaveBeenCalled()
    expect(h.release).not.toHaveBeenCalled()
    expect(h.fail).not.toHaveBeenCalled()
  })

  it('completes the lease on success', async () => {
    const res = await aiHook.run(event, { type: 'ai' }, {}, { jobId: 'job_1' })
    expect(res).toEqual({ success: true })
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.release).not.toHaveBeenCalled()
    expect(h.fail).not.toHaveBeenCalled()
  })

  it('releases the lease on a retryable failure so a retry re-runs the analysis', async () => {
    // A retryable network error thrown out of the completeHookDelivery call
    // (or any step inside the guarded block) must not leave the lease
    // wedged in 'processing' for the rest of the 5-minute window.
    h.complete.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    const res = await aiHook.run(event, { type: 'ai' }, {}, { jobId: 'job_1' })
    expect(res).toMatchObject({ success: false, shouldRetry: true })
    expect(h.release).toHaveBeenCalledOnce()
    expect(h.fail).not.toHaveBeenCalled()
  })

  it('fails the lease permanently on a non-retryable failure', async () => {
    h.complete.mockRejectedValueOnce(new Error('unexpected shape'))
    const res = await aiHook.run(event, { type: 'ai' }, {}, { jobId: 'job_1' })
    expect(res).toMatchObject({ success: false, shouldRetry: false })
    expect(h.fail).toHaveBeenCalledOnce()
    expect(h.release).not.toHaveBeenCalled()
  })

  it('treats individual sentiment/embedding failures as best-effort, not a lease failure', async () => {
    h.analyzeSentiment.mockRejectedValue(new Error('openai down'))
    h.generatePostEmbedding.mockRejectedValue(new Error('openai down'))
    const res = await aiHook.run(event, { type: 'ai' }, {}, { jobId: 'job_1' })
    expect(res).toEqual({ success: true })
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.release).not.toHaveBeenCalled()
    expect(h.fail).not.toHaveBeenCalled()
  })
})
