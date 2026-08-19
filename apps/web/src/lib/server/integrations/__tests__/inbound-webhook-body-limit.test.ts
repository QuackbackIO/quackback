/**
 * The inbound webhook orchestrator caps how much raw body it buffers before
 * signature verification, rejecting oversized payloads with 413.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getIntegration = vi.fn()
const integrationsFindFirst = vi.fn()
const verifySignature = vi.fn()
const parseStatusChange = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      integrations: { findFirst: (...a: unknown[]) => integrationsFindFirst(...a) },
      postExternalLinks: { findFirst: vi.fn() },
    },
  },
  eq: vi.fn(),
  and: vi.fn(),
  integrations: {},
  postExternalLinks: {},
}))
vi.mock('../index', () => ({ getIntegration: (...a: unknown[]) => getIntegration(...a) }))
vi.mock('../encryption', () => ({ decryptSecrets: vi.fn(() => ({})) }))
vi.mock('../status-mapping', () => ({ resolveStatusMapping: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.status', () => ({ changeStatus: vi.fn() }))
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}))

import { MAX_WEBHOOK_BODY_BYTES } from '@/lib/server/utils/read-body'
import { handleInboundWebhook } from '../inbound-webhook-handler'

function req(body: string): Request {
  return new Request('http://localhost/api/integrations/linear/webhook', {
    method: 'POST',
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getIntegration.mockReturnValue({ inbound: { verifySignature, parseStatusChange } })
  integrationsFindFirst.mockResolvedValue(undefined)
})

describe('handleInboundWebhook body limit', () => {
  it('413s an oversized body before any lookup or signature verification', async () => {
    const body = 'x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1)
    const res = await handleInboundWebhook(req(body), 'linear')

    expect(res.status).toBe(413)
    expect(integrationsFindFirst).not.toHaveBeenCalled()
    expect(verifySignature).not.toHaveBeenCalled()
  })

  it('still verifies a body within the limit', async () => {
    integrationsFindFirst.mockResolvedValue({
      config: { webhookSecret: 'whsec' },
      secrets: null,
      principalId: null,
    })
    verifySignature.mockResolvedValue(new Response('Invalid signature', { status: 401 }))

    const res = await handleInboundWebhook(req('{}'), 'linear')

    expect(verifySignature).toHaveBeenCalledTimes(1)
    expect(verifySignature.mock.calls[0][1]).toBe('{}')
    expect(res.status).toBe(401)
  })
})
