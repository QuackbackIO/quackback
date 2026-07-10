/**
 * Redis-backed fixed-window rate limiter for API authentication, shared
 * across replicas. Built on the shared `redis-rate-bucket` primitive
 * (INCR + EXPIRE NX) so this limiter shares plumbing with the sign-in
 * limiters rather than re-implementing bucket bookkeeping.
 *
 * SECURITY NOTE: This trusts proxy headers (cf-connecting-ip, x-forwarded-for).
 * The application MUST be deployed behind a trusted reverse proxy (Cloudflare, nginx)
 * that sets these headers. Direct exposure to the internet allows header spoofing.
 */
import {
  bucketRetryAfter,
  incrementBucket,
  type RateBucketSpec,
} from '@/lib/server/utils/redis-rate-bucket'

// Configuration
const WINDOW_SECONDS = 60 // 1 minute
const MAX_REQUESTS = 100 // 100 requests per minute per IP — used when tier limit is null (OSS)
const IMPORT_MIN = 2000 // Floor for import-mode caps so a tight per-minute tier doesn't choke bulk imports

const rateLimitKey = (ip: string): string => `api:rl:${ip}`

/**
 * Check if a request is rate limited.
 *
 * @param ip - The client IP address
 * @param importMode - Whether the request is in import mode (higher limit)
 * @returns Object with allowed flag and remaining requests
 *
 * Tier-aware: when settings.tier_limits has a non-null apiRequestsPerMinute,
 * that value overrides the default cap. Import mode multiplies the per-minute
 * cap by 20 (matching the historical 100 -> 2000 ratio).
 *
 * Self-hosters with no tier_limits row get null and fall back to MAX_REQUESTS.
 *
 * The counter is keyed by IP only (not mode), so import-mode and
 * normal-mode calls for the same IP share one count — only the cap
 * chosen per call differs. Fails open on Redis errors.
 */
export async function checkRateLimit(
  ip: string,
  importMode?: boolean
): Promise<{
  allowed: boolean
  remaining: number
  retryAfter?: number
}> {
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const limits = await getTierLimits()
  const baseLimit = limits.apiRequestsPerMinute ?? MAX_REQUESTS
  const maxRequests = importMode ? Math.max(baseLimit * 20, IMPORT_MIN) : baseLimit

  const spec: RateBucketSpec = { key: rateLimitKey(ip), windowSeconds: WINDOW_SECONDS }
  const { count } = await incrementBucket(spec)

  // Redis error → fail open.
  if (count === null) return { allowed: true, remaining: maxRequests }

  if (count > maxRequests) {
    return { allowed: false, remaining: 0, retryAfter: await bucketRetryAfter(spec) }
  }

  return { allowed: true, remaining: Math.max(0, maxRequests - count) }
}

/**
 * Extract client IP from request headers.
 * Checks common proxy headers for the real client IP.
 *
 * Accepts a full `Request` or just `Headers` — server functions only
 * have `Headers` via `getRequestHeaders()`, so the Headers overload
 * lets them call this without forging a synthetic Request.
 */
export function getClientIp(source: Request | Headers): string {
  const headers = source instanceof Headers ? source : source.headers

  // Check Cloudflare header first
  const cfIp = headers.get('cf-connecting-ip')
  if (cfIp) return cfIp

  // Check X-Forwarded-For (may contain comma-separated list)
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim()
    if (firstIp) return firstIp
  }

  // Check X-Real-IP
  const realIp = headers.get('x-real-ip')
  if (realIp) return realIp

  // Fallback to unknown
  return 'unknown'
}
