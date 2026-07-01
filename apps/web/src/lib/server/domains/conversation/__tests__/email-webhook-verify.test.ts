/**
 * Resend inbound webhooks are signed with the Svix scheme (the standard
 * `webhook-id` / `webhook-timestamp` / `webhook-signature` headers). These
 * cases pin the verification against a fixed vector so a regression in the HMAC
 * construction is caught, plus the rejection paths. The signature below was
 * computed independently with OpenSSL over `${id}.${timestamp}.${body}` using
 * the base64-decoded secret, i.e. the documented Svix construction.
 */
import { describe, it, expect } from 'vitest'
import { verifyResendWebhookSignature } from '../email-webhook-verify'

const VECTOR = {
  secret: 'whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oD',
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  body: '{"test": 2432232314}',
  signature: 'v1,78nXHjpFP0tVJQW5D0SBwmVyyW87BV/rL6MgfM/Bw44=',
}
// Pin "now" near the vector's timestamp so the freshness check passes.
const NOW = 1614265330_000

describe('verifyResendWebhookSignature', () => {
  it('accepts a valid Svix signature (reference vector)', () => {
    expect(verifyResendWebhookSignature({ ...VECTOR, now: NOW })).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(
      verifyResendWebhookSignature({ ...VECTOR, body: '{"test": 9999999999}', now: NOW })
    ).toBe(false)
  })

  it('rejects when a required header is missing', () => {
    expect(verifyResendWebhookSignature({ ...VECTOR, id: null, now: NOW })).toBe(false)
    expect(verifyResendWebhookSignature({ ...VECTOR, signature: null, now: NOW })).toBe(false)
    expect(verifyResendWebhookSignature({ ...VECTOR, timestamp: null, now: NOW })).toBe(false)
  })

  it('rejects a timestamp outside the freshness window (replay)', () => {
    expect(verifyResendWebhookSignature({ ...VECTOR, now: NOW + 10 * 60 * 1000 })).toBe(false)
  })

  it('accepts when the header carries multiple space-separated signatures and one matches', () => {
    const sig = `v1,aW52YWxpZA== ${VECTOR.signature}`
    expect(verifyResendWebhookSignature({ ...VECTOR, signature: sig, now: NOW })).toBe(true)
  })
})
