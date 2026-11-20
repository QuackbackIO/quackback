/**
 * Inbound status webhooks are never dropped while integrations are paused
 * after the plan limits grace: a verified delivery is queued as usual, and the
 * sync worker holds it until the plan includes integrations (see
 * sync/__tests__/plan-pause.db.test.ts). The inbox channel on the same
 * webhook keeps ingesting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getIntegration: vi.fn(),
  findFirst: vi.fn(),
  verifySignature: vi.fn(),
  queueInboundWebhook: vi.fn(async () => undefined),
  ingestGitHubChannelEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: { query: { integrations: { findFirst: (...a: unknown[]) => h.findFirst(...a) } } },
}))
vi.mock('../index', () => ({ getIntegration: (...a: unknown[]) => h.getIntegration(...a) }))
vi.mock('../sync/inbound', () => ({ queueInboundWebhook: h.queueInboundWebhook }))
vi.mock('@/lib/server/domains/conversation/conversation.github-inbound', () => ({
  ingestGitHubChannelEvent: h.ingestGitHubChannelEvent,
}))
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

import { handleInboundWebhook } from '../inbound-webhook-handler'
import {
  FEATURE_STATES,
  setFeatureState,
} from '@/lib/server/domains/plan-limits/__tests__/feature-states'

function req(): Request {
  return new Request('http://localhost/api/integrations/linear/webhook', {
    method: 'POST',
    body: '{"action":"update"}',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getIntegration.mockReturnValue({ inbound: { verifySignature: h.verifySignature } })
  h.findFirst.mockResolvedValue({ id: 'integration_1', config: { webhookSecret: 'whsec_acme' } })
  h.verifySignature.mockResolvedValue(true)
})

describe('inbound webhooks and the plan limits pause', () => {
  it.each(FEATURE_STATES)('queues a verified delivery in the %s state', async (state) => {
    setFeatureState(state, 'integrations')
    const res = await handleInboundWebhook(req(), 'linear')
    expect(res.status).toBe(200)
    expect(h.verifySignature).toHaveBeenCalledOnce()
    expect(h.queueInboundWebhook).toHaveBeenCalledOnce()
  })

  it('still refuses a bad signature while paused', async () => {
    setFeatureState('enforced', 'integrations')
    h.verifySignature.mockResolvedValue(new Response('bad', { status: 401 }))
    expect((await handleInboundWebhook(req(), 'linear')).status).toBe(401)
    expect(h.queueInboundWebhook).not.toHaveBeenCalled()
  })

  it('keeps the inbox channel ingesting while paused', async () => {
    setFeatureState('enforced', 'integrations')
    const res = await handleInboundWebhook(req(), 'github')
    expect(res.status).toBe(200)
    expect(h.ingestGitHubChannelEvent).toHaveBeenCalledOnce()
    expect(h.queueInboundWebhook).toHaveBeenCalledOnce()
  })
})
