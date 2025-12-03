/**
 * Simple in-memory rate limiter for authentication endpoints
 *
 * This provides basic protection against brute force attacks.
 * For production at scale, consider using Redis-based rate limiting
 * (e.g., @upstash/ratelimit) for distributed rate limiting.
 *
 * Features:
 * - Sliding window rate limiting
 * - Automatic cleanup of old entries
 * - IP-based and identifier-based limits
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

// In-memory store (process-local, cleared on restart)
const rateLimitStore = new Map<string, RateLimitEntry>()

// Cleanup interval (every 5 minutes)
let cleanupInterval: ReturnType<typeof setInterval> | null = null

function startCleanup() {
  if (cleanupInterval) return
  cleanupInterval = setInterval(
    () => {
      const now = Date.now()
      for (const [key, entry] of rateLimitStore) {
        if (entry.resetAt < now) {
          rateLimitStore.delete(key)
        }
      }
    },
    5 * 60 * 1000
  )
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number
  /** Time window in milliseconds */
  windowMs: number
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  success: boolean
  /** Number of requests remaining in the window */
  remaining: number
  /** Timestamp when the limit resets */
  resetAt: number
}

/**
 * Check rate limit for a given identifier
 *
 * @param identifier - Unique identifier (e.g., IP address, user ID, email)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export function checkRateLimit(identifier: string, config: RateLimitConfig): RateLimitResult {
  startCleanup()

  const now = Date.now()
  const entry = rateLimitStore.get(identifier)

  // No existing entry or window expired - allow and create new entry
  if (!entry || entry.resetAt < now) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + config.windowMs,
    }
    rateLimitStore.set(identifier, newEntry)
    return {
      success: true,
      remaining: config.limit - 1,
      resetAt: newEntry.resetAt,
    }
  }

  // Within window - check limit
  if (entry.count >= config.limit) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
    }
  }

  // Increment and allow
  entry.count++
  return {
    success: true,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt,
  }
}

/**
 * Pre-configured rate limits for common scenarios
 */
export const rateLimits = {
  /** Login attempts: 5 per minute per IP */
  login: { limit: 5, windowMs: 60 * 1000 },

  /** Signup attempts: 3 per minute per IP */
  signup: { limit: 3, windowMs: 60 * 1000 },

  /** Password reset: 3 per 15 minutes per email */
  passwordReset: { limit: 3, windowMs: 15 * 60 * 1000 },

  /** Workspace creation: 3 per hour per IP */
  workspaceCreation: { limit: 3, windowMs: 60 * 60 * 1000 },

  /** API general: 100 per minute per IP */
  apiGeneral: { limit: 100, windowMs: 60 * 1000 },
} as const

/**
 * Get client IP from request headers
 * Handles common proxy headers (X-Forwarded-For, X-Real-IP)
 */
export function getClientIp(headers: Headers): string {
  // Check X-Forwarded-For first (may contain multiple IPs)
  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    // Take the first IP (original client)
    const ips = forwardedFor.split(',').map((ip) => ip.trim())
    if (ips[0]) return ips[0]
  }

  // Check X-Real-IP
  const realIp = headers.get('x-real-ip')
  if (realIp) return realIp

  // Fallback to connection remote address (not available in Edge runtime)
  return 'unknown'
}

/**
 * Create rate limit headers for response
 */
export function createRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    ...(result.success
      ? {}
      : { 'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)) }),
  }
}
