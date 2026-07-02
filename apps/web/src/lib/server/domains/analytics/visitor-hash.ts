/**
 * Cookieless visitor identity for analytics.
 *
 * A visitor key is hash(daily_salt + site_origin + ip + user_agent). Salts are
 * date-keyed in Redis (UTC calendar day) and expire after 48h, so a key
 * becomes unrecoverable once its salt ages out: same-day visits collapse to
 * one visitor, and cross-day re-identification is impossible by construction.
 * The raw IP and User-Agent exist only as inputs here; they are never stored.
 */
import { createHash, randomBytes } from 'node:crypto'
import { getRedis } from '@/lib/server/redis'
import { logger } from '@/lib/server/logger'
import { toIsoDateOnly } from '@/lib/shared/utils/date'

const log = logger.child({ component: 'visitor-hash' })

const SALT_TTL_SECONDS = 48 * 60 * 60

/** UTC calendar date (YYYY-MM-DD) used to key daily salts. */
export function utcDateKey(now: Date = new Date()): string {
  return toIsoDateOnly(now)
}

// The salt is constant per UTC day, so the beacon hot path serves it from
// process memory; Redis is only consulted on each pod's first beacon of a day.
let cachedSalt: { dateKey: string; salt: string } | null = null

/**
 * Get-or-create the salt for the given UTC day. Race-safe across pods:
 * SET NX keeps the first writer's salt, the follow-up GET reads whichever
 * value won. The 48h TTL lets a salt survive its own day plus the midnight
 * boundary, then deletes it — that deletion is the privacy guarantee.
 *
 * Returns null when Redis is unavailable; callers must drop the event
 * rather than persist anything derived from raw identifiers without a salt.
 */
export async function getDailySalt(now: Date = new Date()): Promise<string | null> {
  const dateKey = utcDateKey(now)
  if (cachedSalt?.dateKey === dateKey) return cachedSalt.salt
  try {
    const redis = getRedis()
    const fresh = randomBytes(32).toString('hex')
    await redis.set(`visitor:salt:${dateKey}`, fresh, 'EX', SALT_TTL_SECONDS, 'NX')
    const salt = await redis.get(`visitor:salt:${dateKey}`)
    if (salt) cachedSalt = { dateKey, salt }
    return salt
  } catch (error) {
    log.error({ err: error }, 'daily salt unavailable, dropping event')
    return null
  }
}

/**
 * The layer-1 visitor key. NUL separators prevent boundary ambiguity
 * between concatenated components.
 */
export function computeVisitorHash(input: {
  salt: string
  siteOrigin: string
  ip: string
  userAgent: string
}): string {
  return createHash('sha256')
    .update(`${input.salt}\u0000${input.siteOrigin}\u0000${input.ip}\u0000${input.userAgent}`)
    .digest('hex')
}
