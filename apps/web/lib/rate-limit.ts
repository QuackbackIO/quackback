/**
 * Rate limiter with Redis support for distributed environments
 *
 * Features:
 * - Sliding window rate limiting
 * - Redis-backed for distributed rate limiting (via Dragonfly)
 * - Automatic fallback to in-memory when Redis unavailable
 * - IP-based and identifier-based limits
 */

import { Redis } from 'ioredis'

interface RateLimitEntry {
  count: number
  resetAt: number
}

// In-memory store (process-local, cleared on restart) - used as fallback
const rateLimitStore = new Map<string, RateLimitEntry>()

// Redis client (lazy-initialized)
let redis: Redis | null = null
let redisInitAttempted = false

function getRedis(): Redis | null {
  if (redis) return redis
  if (redisInitAttempted) return null

  redisInitAttempted = true
  const url = process.env.REDIS_URL
  if (!url) return null

  try {
    const parsed = new URL(url)
    redis = new Redis({
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableReadyCheck: false,
    })

    // Handle connection errors silently (fallback to in-memory)
    redis.on('error', () => {
      redis = null
    })

    return redis
  } catch {
    return null
  }
}

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

  /** OTP code requests: 3 per 15 minutes per email */
  otpRequest: { limit: 3, windowMs: 15 * 60 * 1000 },

  /** Workspace creation: 3 per hour per IP */
  workspaceCreation: { limit: 3, windowMs: 60 * 60 * 1000 },

  /** API general: 100 per minute per IP */
  apiGeneral: { limit: 100, windowMs: 60 * 1000 },

  /** Vote attempts (anonymous): 20 per minute per IP */
  voteGlobalAnonymous: { limit: 20, windowMs: 60 * 1000 },

  /** Vote attempts per post (anonymous): 5 per minute */
  votePerPostAnonymous: { limit: 5, windowMs: 60 * 1000 },

  /** Vote attempts (authenticated): 60 per minute per user */
  voteGlobalAuthenticated: { limit: 60, windowMs: 60 * 1000 },

  /** Vote attempts per post (authenticated): 10 per minute */
  votePerPostAuthenticated: { limit: 10, windowMs: 60 * 1000 },

  /** Signin code requests: 5 per 15 minutes per IP */
  signinCode: { limit: 5, windowMs: 15 * 60 * 1000 },

  /** Signin code verification: 10 per 15 minutes per IP */
  signinCodeVerify: { limit: 10, windowMs: 15 * 60 * 1000 },
} as const

/**
 * Check rate limit using Redis (distributed) with in-memory fallback
 *
 * Uses Redis sorted sets for accurate sliding window rate limiting.
 * Falls back to in-memory rate limiting if Redis is unavailable.
 *
 * @param identifier - Unique identifier (e.g., IP address, user ID)
 * @param config - Rate limit configuration
 * @returns Rate limit result (async)
 */
export async function checkRateLimitRedis(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const client = getRedis()

  // Fallback to in-memory if Redis unavailable
  if (!client) {
    return checkRateLimit(identifier, config)
  }

  const key = `ratelimit:${identifier}`
  const now = Date.now()
  const windowStart = now - config.windowMs

  try {
    // Use Redis sorted set for sliding window
    const multi = client.multi()
    multi.zremrangebyscore(key, 0, windowStart) // Remove old entries
    multi.zadd(key, now, `${now}:${Math.random()}`) // Add current request with unique member
    multi.zcard(key) // Count requests in window
    multi.pexpire(key, config.windowMs) // Set expiry

    const results = await multi.exec()
    const count = (results?.[2]?.[1] as number) || 0

    return {
      success: count <= config.limit,
      remaining: Math.max(0, config.limit - count),
      resetAt: now + config.windowMs,
    }
  } catch {
    // Fallback to in-memory on error
    return checkRateLimit(identifier, config)
  }
}

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
