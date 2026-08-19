/**
 * Resend inbound-email webhook signature verification (Svix scheme), kept pure
 * so it's unit-tested against Svix's reference vector. Resend signs webhooks
 * with Svix's standard headers (`webhook-id` / `webhook-timestamp` /
 * `webhook-signature`); the signing secret is `whsec_<base64-key>`.
 *
 * Construction: base64( HMAC-SHA256( base64decode(key), `${id}.${timestamp}.${body}` ) ).
 * The signature header is a space-separated list of `version,signature` tokens
 * (we match any `v1` entry), and a timestamp freshness window guards replay.
 */
import { createHmac, timingSafeEqual } from 'crypto'

const DEFAULT_TOLERANCE_S = 5 * 60

export function verifyResendWebhookSignature(opts: {
  id: string | null
  timestamp: string | null
  signature: string | null
  body: string
  secret: string
  /** Override the clock (ms) for testing; defaults to now. */
  now?: number
  toleranceSeconds?: number
}): boolean {
  const { id, timestamp, signature, body, secret } = opts
  if (!id || !timestamp || !signature || !secret) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const nowS = Math.floor((opts.now ?? Date.now()) / 1000)
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_S
  if (Math.abs(nowS - ts) > tolerance) return false

  const keyBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  if (keyBytes.byteLength === 0) return false
  const expected = createHmac('sha256', keyBytes).update(`${id}.${timestamp}.${body}`).digest()

  // Header: space-separated `version,signature` tokens; match any v1 entry.
  for (const token of signature.split(' ')) {
    const comma = token.indexOf(',')
    if (comma === -1) continue
    const version = token.slice(0, comma)
    if (version !== 'v1') continue
    let provided: Buffer
    try {
      provided = Buffer.from(token.slice(comma + 1), 'base64')
    } catch {
      continue
    }
    if (provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected)) {
      return true
    }
  }
  return false
}
