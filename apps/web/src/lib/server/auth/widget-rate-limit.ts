/**
 * Per-IP rate limits for the widget's unauthenticated entry points (Phase 6 R1):
 * the anonymous-session mint (Better Auth /sign-in/anonymous) and the identify
 * handshake. Both are open to the internet, so without a bound a single client
 * can flood the session table or brute-force ssoTokens. Built on the shared
 * redis-rate-bucket (durable across instances); fails OPEN on a Redis error so a
 * cache blip never locks visitors out.
 *
 * Keyed on the real client IP (getClientIp reads cf-connecting-ip behind the
 * trusted proxy), so the caps target one client, not a shared proxy. Generous
 * enough for a NAT'd office where many real visitors share one public IP.
 */
import {
  bucketRetryAfter,
  incrementBuckets,
  type RateBucketSpec,
} from '@/lib/server/utils/redis-rate-bucket'

export interface WidgetRateLimitResult {
  allowed: boolean
  retryAfter?: number
}

const ANON_MINT_LIMIT = 100
const ANON_MINT_WINDOW_S = 10 * 60
const IDENTIFY_LIMIT = 60
const IDENTIFY_WINDOW_S = 15 * 60

/** Increment every bucket, then block on the first over its cap. A null count
 *  (Redis error) fails open. */
async function limit(specs: RateBucketSpec[], limits: number[]): Promise<WidgetRateLimitResult> {
  const counts = await incrementBuckets(specs)
  if (counts.some((c) => c === null)) return { allowed: true }
  for (let i = 0; i < specs.length; i++) {
    if ((counts[i] as number) > limits[i]) {
      return { allowed: false, retryAfter: await bucketRetryAfter(specs[i]) }
    }
  }
  return { allowed: true }
}

/** Bound how many anonymous sessions one client can mint — the session-table
 *  flood defence. */
export function checkAnonMintRateLimit(ip: string): Promise<WidgetRateLimitResult> {
  return limit(
    [{ key: `widget:mint:ip:${ip}`, windowSeconds: ANON_MINT_WINDOW_S }],
    [ANON_MINT_LIMIT]
  )
}

/** Bound identify attempts per client — the ssoToken brute-force + identity-churn
 *  defence. */
export function checkWidgetIdentifyRateLimit(ip: string): Promise<WidgetRateLimitResult> {
  return limit(
    [{ key: `widget:identify:ip:${ip}`, windowSeconds: IDENTIFY_WINDOW_S }],
    [IDENTIFY_LIMIT]
  )
}
