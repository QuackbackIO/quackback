/**
 * Webhook deliveries pause when the plan no longer includes webhooks after the
 * plan limits grace. A paused delivery is dropped, not queued: the job reports
 * success so it is never retried, and nothing is sent or written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  claim: vi.fn(async () => true),
  findFirstWebhook: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
    query: { webhooks: { findFirst: (...args: unknown[]) => h.findFirstWebhook(...args) } },
  },
}))
vi.mock('@/lib/server/content/ssrf-guard', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/content/ssrf-guard')>()),
  safeFetch: (...a: unknown[]) => h.safeFetch(...a),
}))
vi.mock('../hook-idempotency', () => ({
  claimHookDelivery: () => h.claim(),
  releaseHookDelivery: vi.fn(async () => undefined),
  completeHookDelivery: vi.fn(async () => undefined),
  failHookDelivery: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/domains/webhooks/encryption', () => ({
  decryptWebhookSecret: (ciphertext: string) => ciphertext,
}))
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

import { webhookHook } from '../handlers/webhook'
import {
  FEATURE_STATES,
  runsWithoutPlanGate,
  setFeatureState,
} from '@/lib/server/domains/plan-limits/__tests__/feature-states'

const event = {
  id: 'evt_1',
  type: 'post.created',
  timestamp: '2026-01-01T00:00:00Z',
  actor: { type: 'user' },
  data: { post: { id: 'post_1' } },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.findFirstWebhook.mockResolvedValue({
    secret: 'whsec_acme',
    url: 'https://hooks.example.com/deliver',
    status: 'active',
    deletedAt: null,
  })
  h.safeFetch.mockResolvedValue({ ok: true, status: 200 } as Response)
})

describe('webhook delivery and the plan limits pause', () => {
  it.each(FEATURE_STATES)('in the %s state', async (state) => {
    setFeatureState(state, 'webhooks')
    const result = await webhookHook.run(event, {}, { webhookId: 'webhook_1' }, { jobId: 'job_1' })

    expect(result).toEqual({ success: true })
    if (runsWithoutPlanGate(state)) {
      expect(h.safeFetch).toHaveBeenCalledOnce()
    } else {
      // Dropped before the claim and the row read: no delivery, no record.
      expect(h.safeFetch).not.toHaveBeenCalled()
      expect(h.claim).not.toHaveBeenCalled()
      expect(h.findFirstWebhook).not.toHaveBeenCalled()
    }
  })

  it('delivers when only another feature is paused', async () => {
    setFeatureState('enforced', 'workflows')
    await webhookHook.run(event, {}, { webhookId: 'webhook_1' }, { jobId: 'job_1' })
    expect(h.safeFetch).toHaveBeenCalledOnce()
  })
})
