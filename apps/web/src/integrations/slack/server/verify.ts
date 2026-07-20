/**
 * Slack request signature verification (HMAC-SHA256).
 * Shared by interactivity and events handlers.
 */

import { timingSafeEqual, createHmac } from 'crypto'

const REPLAY_WINDOW_S = 60 * 5 // 5 minutes

/**
 * Verify Slack request signature.
 * Returns true if valid, or a Response with the rejection reason.
 */
export function verifySlackSignature(
  body: string,
  timestamp: string | null,
  signature: string | null,
  signingSecret: string
): true | Response {
  if (!timestamp || !signature) {
    return new Response('Missing signature headers', { status: 401 })
  }

  const ts = parseInt(timestamp, 10)
  if (isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > REPLAY_WINDOW_S) {
    return new Response('Request too old', { status: 401 })
  }

  const basestring = `v0:${timestamp}:${body}`
  const expected = Buffer.from(
    `v0=${createHmac('sha256', signingSecret).update(basestring).digest('hex')}`
  )
  const actual = Buffer.from(signature)

  const valid = expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual)

  if (!valid) {
    return new Response('Invalid signature', { status: 401 })
  }

  return true
}
