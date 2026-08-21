/**
 * The webhook seam: handler + real signature verification, unmocked.
 *
 * email-webhook-verify.test.ts proves the crypto against Svix's reference
 * vector, and email-webhook-handler.test.ts proves the routing — but the latter
 * stubs verification out entirely. So both suites stay green even if the
 * handler hands verify the wrong things, which is where webhook integrations
 * actually break:
 *
 *   - reading the wrong header names (every real delivery 401s)
 *   - signing over a re-serialized body instead of the raw bytes, so any
 *     payload whose key order or whitespace differs from the provider's fails
 *
 * These tests build genuine Svix signatures and let the real verifier run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'

// The door's own gate, which is not the minting question: see
// `isEmailInboundWebhookConfigured`. A mint domain this install cannot use
// costs a Reply-To; closing this door would cost the message.
const isEmailInboundWebhookConfigured = vi.fn<() => boolean>()
const ingestInboundEmail = vi.fn()
const isConversationsEnabled = vi.fn<() => Promise<boolean>>()

vi.mock('../conversation.email-channel', () => ({
  isEmailInboundWebhookConfigured: (...a: []) => isEmailInboundWebhookConfigured(...a),
}))
vi.mock('../conversation.email-inbound.service', () => ({
  ingestInboundEmail: (...a: unknown[]) => ingestInboundEmail(...a),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: () => isConversationsEnabled(),
}))
// Deliberately NOT mocking ../email-webhook-verify.

import { handleInboundEmailWebhook } from '../email-webhook-handler'

const SECRET_KEY = Buffer.from('quackback-inbound-test-key-32byte').toString('base64')
const SECRET = `whsec_${SECRET_KEY}`
const WEBHOOK_ID = 'msg_2xY3'

/** Sign exactly as Svix does: base64(HMAC-SHA256(key, `id.timestamp.body`)). */
function sign(body: string, timestamp: number): string {
  const mac = createHmac('sha256', Buffer.from(SECRET_KEY, 'base64'))
    .update(`${WEBHOOK_ID}.${timestamp}.${body}`)
    .digest('base64')
  return `v1,${mac}`
}

function signedRequest(
  body: string,
  opts: { timestamp?: number; prefix?: 'webhook' | 'svix'; signature?: string } = {}
): Request {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const prefix = opts.prefix ?? 'webhook'
  return new Request('http://localhost/api/chat/email/inbound', {
    method: 'POST',
    headers: {
      [`${prefix}-id`]: WEBHOOK_ID,
      [`${prefix}-timestamp`]: String(timestamp),
      [`${prefix}-signature`]: opts.signature ?? sign(body, timestamp),
    },
    body,
  })
}

const EVENT = { type: 'email.received', data: { email_id: 'email_1', from: 'a@b.test' } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  process.env.EMAIL_INBOUND_SIGNING_SECRET = SECRET
  isEmailInboundWebhookConfigured.mockReturnValue(true)
  isConversationsEnabled.mockResolvedValue(true)
  ingestInboundEmail.mockResolvedValue({ status: 'ingested', conversationId: 'conversation_1' })
})

describe('inbound email webhook — real signature verification', () => {
  it('accepts a genuinely signed event and routes it to ingestion', async () => {
    const body = JSON.stringify(EVENT)
    const res = await handleInboundEmailWebhook(signedRequest(body))

    expect(res.status).toBe(200)
    expect(ingestInboundEmail).toHaveBeenCalledOnce()
    expect(ingestInboundEmail.mock.calls[0][0]).toMatchObject({ type: 'email.received' })
  })

  it('verifies against the raw bytes, not a re-serialized body', async () => {
    // Same JSON, provider-chosen key order and incidental whitespace. Signing
    // covers these exact bytes; anything that re-serializes before verifying
    // produces a different digest and 401s every real delivery.
    const body =
      '{\n  "data" : {"from":"a@b.test","email_id":"email_1"},\n  "type": "email.received"\n}'
    const res = await handleInboundEmailWebhook(signedRequest(body))

    expect(res.status).toBe(200)
    expect(ingestInboundEmail).toHaveBeenCalledOnce()
  })

  it('accepts the svix-* header aliases as well as webhook-*', async () => {
    const body = JSON.stringify(EVENT)
    const res = await handleInboundEmailWebhook(signedRequest(body, { prefix: 'svix' }))

    expect(res.status).toBe(200)
    expect(ingestInboundEmail).toHaveBeenCalledOnce()
  })

  it('401s a body tampered with after signing, without ingesting', async () => {
    const body = JSON.stringify(EVENT)
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = sign(body, timestamp)
    const tampered = JSON.stringify({
      ...EVENT,
      data: { ...EVENT.data, from: 'attacker@evil.test' },
    })

    const res = await handleInboundEmailWebhook(signedRequest(tampered, { timestamp, signature }))

    expect(res.status).toBe(401)
    expect(ingestInboundEmail).not.toHaveBeenCalled()
  })

  it('401s a replayed event outside the freshness window', async () => {
    const body = JSON.stringify(EVENT)
    const stale = Math.floor(Date.now() / 1000) - 60 * 60
    const res = await handleInboundEmailWebhook(signedRequest(body, { timestamp: stale }))

    expect(res.status).toBe(401)
    expect(ingestInboundEmail).not.toHaveBeenCalled()
  })

  it('401s when the signature was made with a different secret', async () => {
    const body = JSON.stringify(EVENT)
    const timestamp = Math.floor(Date.now() / 1000)
    const otherKey = Buffer.from('a-completely-different-signing-key').toString('base64')
    const forged = `v1,${createHmac('sha256', Buffer.from(otherKey, 'base64'))
      .update(`${WEBHOOK_ID}.${timestamp}.${body}`)
      .digest('base64')}`

    const res = await handleInboundEmailWebhook(
      signedRequest(body, { timestamp, signature: forged })
    )

    expect(res.status).toBe(401)
    expect(ingestInboundEmail).not.toHaveBeenCalled()
  })

  it('401s when the deployment has no signing secret configured', async () => {
    // An empty secret must fail closed rather than skip verification.
    delete process.env.EMAIL_INBOUND_SIGNING_SECRET
    const body = JSON.stringify(EVENT)
    const res = await handleInboundEmailWebhook(signedRequest(body))

    expect(res.status).toBe(401)
    expect(ingestInboundEmail).not.toHaveBeenCalled()
  })
})
