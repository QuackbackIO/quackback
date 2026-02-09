/**
 * Simple in-memory rate limiter for API authentication
 *
 * Uses a sliding window algorithm to track request counts per IP.
 * Designed to prevent brute-force attacks on API key authentication.
 *
 * SECURITY NOTE: This trusts proxy headers (cf-connecting-ip, x-forwarded-for).
 * The application MUST be deployed behind a trusted reverse proxy (Cloudflare, nginx)
 * that sets these headers. Direct exposure to the internet allows header spoofing.
 */

interface RateLimitEntry {
  count: number
  windowStart: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Configuration
const WINDOW_MS = 60_000 // 1 minute
const MAX_REQUESTS = 100 // 100 requests per minute per IP
const MAX_STORE_SIZE = 50_000 // Cap store size to prevent memory exhaustion
const CLEANUP_INTERVAL_MS = 60_000 // Cleanup every minute

// Cleanup old entries periodically
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now - entry.windowStart > WINDOW_MS) {
        rateLimitStore.delete(key)
      }
    }
  }, CLEANUP_INTERVAL_MS)
  // Don't prevent process from exiting
  cleanupTimer.unref?.()
}

startCleanup()

/**
 * Check if a request is rate limited.
 *
 * @param ip - The client IP address
 * @returns Object with allowed flag and remaining requests
 */
export function checkRateLimit(ip: string): {
  allowed: boolean
  remaining: number
  retryAfter?: number
} {
  const now = Date.now()
  const entry = rateLimitStore.get(ip)

  // New IP or window expired - reset
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Cap store size to prevent memory exhaustion from spoofed IPs
    if (rateLimitStore.size >= MAX_STORE_SIZE && !entry) {
      return { allowed: false, remaining: 0, retryAfter: 60 }
    }
    rateLimitStore.set(ip, { count: 1, windowStart: now })
    return { allowed: true, remaining: MAX_REQUESTS - 1 }
  }

  // Within window - increment and check
  entry.count++

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000)
    return { allowed: false, remaining: 0, retryAfter }
  }

  return { allowed: true, remaining: MAX_REQUESTS - entry.count }
}

/**
 * Extract client IP from request headers.
 * Checks common proxy headers for the real client IP.
 */
export function getClientIp(request: Request): string {
  // Check Cloudflare header first
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp

  // Check X-Forwarded-For (may contain comma-separated list)
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim()
    if (firstIp) return firstIp
  }

  // Check X-Real-IP
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp

  // Fallback to unknown
  return 'unknown'
}
