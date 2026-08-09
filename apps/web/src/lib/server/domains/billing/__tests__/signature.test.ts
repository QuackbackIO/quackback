/**
 * Webhook signature verification.
 *
 * The endpoint is unauthenticated by necessity — the provider has no
 * credential to present — so this function is the only thing standing between
 * an anonymous POST and a plan change. Each case below is a way that can be
 * got wrong in a way no happy-path test would notice.
 */
import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { signWebhookPayload, verifyWebhookSignature } from '../provider/signature'

const SECRET = 'whsec_test_secret_value'
const NOW = 1_800_000_000
const PAYLOAD = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' })

function verify(overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) {
  return verifyWebhookSignature({
    payload: PAYLOAD,
    header: signWebhookPayload(PAYLOAD, SECRET, NOW),
    secret: SECRET,
    nowSeconds: NOW,
    ...overrides,
  })
}

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed delivery', () => {
    expect(verify()).toEqual({ ok: true, timestamp: NOW })
  })

  it('produces the digest the provider produces', () => {
    // Pinned against an independently computed HMAC rather than against
    // signWebhookPayload's own output, which would be the function agreeing
    // with itself.
    const expected = createHmac('sha256', SECRET).update(`${NOW}.${PAYLOAD}`).digest('hex')
    expect(signWebhookPayload(PAYLOAD, SECRET, NOW)).toBe(`t=${NOW},v1=${expected}`)
  })

  it('rejects a body altered after signing', () => {
    const tampered = PAYLOAD.replace('evt_1', 'evt_2')
    expect(verify({ payload: tampered })).toEqual({ ok: false, reason: 'no_matching_signature' })
  })

  it('rejects a signature made with a different secret', () => {
    expect(verify({ header: signWebhookPayload(PAYLOAD, 'whsec_other', NOW) })).toEqual({
      ok: false,
      reason: 'no_matching_signature',
    })
  })

  it('rejects a signature computed over the body alone', () => {
    // The timestamp is part of the signed string. Omitting it is the single
    // most likely implementation slip, and it still produces a well-formed
    // hex digest of the right length — so only a real comparison catches it.
    const naive = createHmac('sha256', SECRET).update(PAYLOAD).digest('hex')
    expect(verify({ header: `t=${NOW},v1=${naive}` })).toEqual({
      ok: false,
      reason: 'no_matching_signature',
    })
  })

  it('rejects a delivery older than the tolerance', () => {
    expect(verify({ nowSeconds: NOW + 301 })).toEqual({
      ok: false,
      reason: 'timestamp_outside_tolerance',
    })
  })

  it('accepts a delivery at exactly the tolerance boundary', () => {
    expect(verify({ nowSeconds: NOW + 300 })).toEqual({ ok: true, timestamp: NOW })
  })

  it('rejects a delivery stamped in the future beyond tolerance', () => {
    // A one-sided check (`now - t > tolerance`) passes this, which would hand
    // an attacker an arbitrarily long replay window.
    expect(verify({ nowSeconds: NOW - 301 })).toEqual({
      ok: false,
      reason: 'timestamp_outside_tolerance',
    })
  })

  it('accepts when one of several signatures matches, as during a secret rotation', () => {
    const good = signWebhookPayload(PAYLOAD, SECRET, NOW).split('v1=')[1]
    const stale = createHmac('sha256', 'whsec_previous').update(`${NOW}.${PAYLOAD}`).digest('hex')
    expect(verify({ header: `t=${NOW},v1=${stale},v1=${good}` })).toEqual({
      ok: true,
      timestamp: NOW,
    })
  })

  it('reports a missing header distinctly from a bad one', () => {
    expect(verify({ header: null })).toEqual({ ok: false, reason: 'missing_header' })
  })

  it('rejects a header with no timestamp', () => {
    const digest = signWebhookPayload(PAYLOAD, SECRET, NOW).split('v1=')[1]
    expect(verify({ header: `v1=${digest}` })).toEqual({ ok: false, reason: 'malformed_header' })
  })

  it('rejects a header with no signature', () => {
    expect(verify({ header: `t=${NOW}` })).toEqual({ ok: false, reason: 'malformed_header' })
  })

  it('rejects an empty header', () => {
    expect(verify({ header: '' })).toEqual({ ok: false, reason: 'missing_header' })
  })

  it('rejects a signature of a different length without throwing', () => {
    // timingSafeEqual throws on unequal lengths; a naive implementation
    // surfaces that as a 500 rather than a rejection.
    expect(verify({ header: `t=${NOW},v1=abc` })).toEqual({
      ok: false,
      reason: 'no_matching_signature',
    })
  })
})
