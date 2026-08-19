/**
 * Redis-backed fixed-window rate limiter for API authentication, shared
 * across replicas. Built on the shared `redis-rate-bucket` primitive
 * (INCR + EXPIRE NX) so this limiter shares plumbing with the sign-in
 * limiters rather than re-implementing bucket bookkeeping.
 *
 * Forwarding headers are ignored unless TRUSTED_PROXY_HOPS is configured;
 * see getClientIp() below for the two resolution modes.
 */
import {
  bucketRetryAfter,
  incrementBucket,
  type RateBucketSpec,
} from '@/lib/server/utils/redis-rate-bucket'
import { isIP } from 'node:net'
import { config } from '@/lib/server/config'
import { getRequestIP } from '@tanstack/react-start/server'

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
 *
 * Accepts a full `Request` or just `Headers` — server functions only
 * have `Headers` via `getRequestHeaders()`, so the Headers overload
 * lets them call this without forging a synthetic Request. The `source`
 * parameter is unused when trustedHops === 0 (see below) but is kept so
 * every call site has one signature regardless of mode.
 *
 * Two resolution modes, chosen by TRUSTED_PROXY_HOPS:
 *
 * - hops === 0 (default, direct exposure): headers are entirely untrusted,
 *   since any client can set X-Forwarded-For/CF-Connecting-IP/X-Real-IP on
 *   a request they send us directly, and honoring them would let a single
 *   attacker spread requests across unlimited rate-limit buckets. Instead
 *   this resolves the actual TCP peer address via TanStack Start's
 *   getRequestIP(), which reads it from the platform connection rather
 *   than from any header. On the Bun preset this is backed by Bun's
 *   `server.requestIP()`, so distinct clients land in distinct buckets even
 *   with zero configured proxies.
 * - hops > 0 (behind N trusted reverse proxies): the client IP is the
 *   (hops)-th entry from the right of X-Forwarded-For, the standard
 *   trusted-hop model. Each trusted proxy appends the peer address it
 *   observed, so counting from the right lands on what the outermost
 *   trusted proxy actually saw regardless of how many untrusted entries a
 *   client prepends further left. Single-value headers like
 *   CF-Connecting-IP/X-Real-IP are intentionally not consulted: unlike
 *   X-Forwarded-For's position-based trust, there is no way to tell
 *   whether such a header was set by a trusted hop or relayed unmodified
 *   from the client, so honoring them would reopen the same spoofing gap.
 *
 * Known limitation: getRequestIP() depends on the platform exposing the
 * socket peer address. That is true for the built Nitro/Bun server this
 * project ships (`bun run start`), but not guaranteed for every dev/test
 * runtime (e.g. `bun run dev`'s Vite dev server). When unavailable, this
 * falls back to the shared 'unknown' bucket, matching pre-existing
 * fail-safe behavior instead of trusting a spoofable header.
 */
export function getClientIp(source: Request | Headers): string {
  const headers = source instanceof Headers ? source : source.headers
  // Startup validates config before serving traffic. Unit-level consumers may
  // intentionally load this helper without a complete runtime environment;
  // fail closed to direct-peer semantics in that case.
  const trustedHops = (() => {
    try {
      return config.trustedProxyHops
    } catch {
      return 0
    }
  })()

  if (trustedHops === 0) {
    try {
      const peer = getRequestIP()
      if (peer && isIP(peer)) return peer
    } catch {
      // Not inside a request context (e.g. some test/tooling setups), so
      // fall through to 'unknown' rather than throwing.
    }
    return 'unknown'
  }

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const chain = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const candidate = chain[Math.max(0, chain.length - trustedHops)]
    if (candidate && isIP(candidate)) return candidate
  }

  // No usable X-Forwarded-For entry at the trusted-hop position.
  return 'unknown'
}
