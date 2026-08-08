/**
 * Webhook signature verification.
 *
 * The provider signs each delivery with an HMAC-SHA256 over
 * `<timestamp>.<raw body>` keyed by the endpoint's signing secret, and sends
 * it in a header of the form:
 *
 *     t=1700000000,v1=<hex>,v1=<hex during a secret rotation>
 *
 * Three properties this implementation deliberately has:
 *
 *  1. **It verifies against the raw bytes.** Re-serialising the parsed JSON
 *     changes key order and whitespace and fails every time, so the route
 *     must hand the untouched body string here.
 *  2. **It compares in constant time.** A byte-by-byte early return leaks the
 *     signature through timing, which is enough to forge one given patience.
 *  3. **It enforces a timestamp tolerance.** Without it, a captured delivery
 *     can be replayed forever. Note this is *anti-replay for the transport*;
 *     it is not the idempotency guarantee — a legitimate redelivery inside
 *     the window is still a valid duplicate, which is what the event ledger
 *     handles.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Deliveries older than this are refused. The provider retries well inside it. */
export const SIGNATURE_TOLERANCE_SECONDS = 300

export type SignatureFailure =
  | 'missing_header'
  | 'malformed_header'
  | 'timestamp_outside_tolerance'
  | 'no_matching_signature'

export type SignatureResult = { ok: true; timestamp: number } | { ok: false; reason: SignatureFailure }

export function verifyWebhookSignature(input: {
  /** The untouched request body, exactly as received. */
  payload: string
  /** The signature header value. */
  header: string | null
  secret: string
  /** Seconds since the epoch. Injected so tests are not clock-dependent. */
  nowSeconds: number
  toleranceSeconds?: number
}): SignatureResult {
  if (!input.header) return { ok: false, reason: 'missing_header' }

  const parts = input.header.split(',')
  let timestamp: number | null = null
  const candidates: string[] = []

  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === 't') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) timestamp = parsed
    } else if (key === 'v1') {
      candidates.push(value)
    }
  }

  if (timestamp === null || candidates.length === 0) {
    return { ok: false, reason: 'malformed_header' }
  }

  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS
  // Absolute difference, so a delivery stamped in the future — a clock skew,
  // or an attacker buying themselves a long-lived replay window — is refused
  // as firmly as a stale one.
  if (Math.abs(input.nowSeconds - timestamp) > tolerance) {
    return { ok: false, reason: 'timestamp_outside_tolerance' }
  }

  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest('hex')

  for (const candidate of candidates) {
    if (constantTimeEquals(expected, candidate)) return { ok: true, timestamp }
  }
  return { ok: false, reason: 'no_matching_signature' }
}

/**
 * Constant-time comparison of two hex strings.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be a
 * timing signal, so unequal lengths are answered false without calling it.
 * Length is not secret — the digest length is fixed and public.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/** Sign a payload the way the provider does. Test helper, and nothing else. */
export function signWebhookPayload(payload: string, secret: string, timestamp: number): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${signature}`
}
