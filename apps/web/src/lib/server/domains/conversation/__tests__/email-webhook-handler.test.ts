/**
 * Inbound email webhook handler: the trust boundary for the email channel. It
 * 404s when the channel is off, rejects an unsigned/forged request, acks event
 * types it doesn't handle so the provider stops retrying, and otherwise routes
 * a verified `email.received` event into ingestion.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isEmailInboundConfigured = vi.fn<() => boolean>()
const verifyResendWebhookSignature = vi.fn<(...a: unknown[]) => boolean>()
const ingestInboundEmail = vi.fn()
const isConversationsEnabled = vi.fn<() => Promise<boolean>>()

vi.mock('../conversation.email-channel', () => ({
  isEmailInboundConfigured: (...a: []) => isEmailInboundConfigured(...a),
}))
vi.mock('../email-webhook-verify', () => ({
  verifyResendWebhookSignature: (...a: unknown[]) => verifyResendWebhookSignature(...a),
}))
vi.mock('../conversation.email-inbound.service', () => ({
  ingestInboundEmail: (...a: unknown[]) => ingestInboundEmail(...a),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: () => isConversationsEnabled(),
}))

import { handleInboundEmailWebhook } from '../email-webhook-handler'

function req(body: unknown): Request {
  return new Request('http://localhost/api/chat/email/inbound', {
    method: 'POST',
    headers: {
      'webhook-id': 'msg_1',
      'webhook-timestamp': '1700000000',
      'webhook-signature': 'v1,sig',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_test'
  isEmailInboundConfigured.mockReturnValue(true)
  verifyResendWebhookSignature.mockReturnValue(true)
  isConversationsEnabled.mockResolvedValue(true)
  ingestInboundEmail.mockResolvedValue({ status: 'ingested', conversationId: 'conversation_1' })
})

describe('handleInboundEmailWebhook', () => {
  it('404s when the email channel is not configured (no verify, no ingest)', async () => {
    isEmailInboundConfigured.mockReturnValue(false)

    const res = await handleInboundEmailWebhook(req({ type: 'email.received' }))

    expect(res.status).toBe(404)
    expect(verifyResendWebhookSignature).not.toHaveBeenCalled()
    expect(ingestInboundEmail).not.toHaveBeenCalled()
  })

  it('401s when the signature is invalid (no ingest)', async () => {
    verifyResendWebhookSignature.mockReturnValue(false)

    const res = await handleInboundEmailWebhook(req({ type: 'email.received' }))

    expect(res.status).toBe(401)
    expect(ingestInboundEmail).not.toHaveBeenCalled()
  })

  it('acks an unrelated event type without ingesting', async () => {
    const res = await handleInboundEmailWebhook(req({ type: 'email.delivered' }))

    expect(res.status).toBe(200)
    expect(ingestInboundEmail).not.toHaveBeenCalled()
  })

  it('routes a verified email.received event into ingestion', async () => {
    const event = { type: 'email.received', data: { to: ['x'] } }
    const res = await handleInboundEmailWebhook(req(event))

    expect(res.status).toBe(200)
    expect(ingestInboundEmail).toHaveBeenCalledTimes(1)
    expect(ingestInboundEmail.mock.calls[0][0]).toMatchObject({ type: 'email.received' })
    await expect(res.json()).resolves.toMatchObject({ status: 'ingested' })
  })

  it('acks and drops a verified event when conversations are disabled (no ingest)', async () => {
    isConversationsEnabled.mockResolvedValue(false)

    const res = await handleInboundEmailWebhook(req({ type: 'email.received' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'disabled' })
    expect(ingestInboundEmail).not.toHaveBeenCalled()
  })

  it('400s on a malformed JSON body (after signature check)', async () => {
    const res = await handleInboundEmailWebhook(req('not json{'))

    expect(res.status).toBe(400)
    expect(ingestInboundEmail).not.toHaveBeenCalled()
  })

  it('500s when ingestion throws (lets the provider retry)', async () => {
    ingestInboundEmail.mockRejectedValue(new Error('db down'))

    const res = await handleInboundEmailWebhook(req({ type: 'email.received' }))

    expect(res.status).toBe(500)
  })
})
