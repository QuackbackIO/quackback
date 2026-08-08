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
import { tenantKey, TenantKeyedCache } from '@/lib/server/tenancy/tenant-keyed'
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
//
// Per tenant, in both the heap and Redis. A shared salt would hash the same
// visitor to the same key in every workspace, so the layer-1 key becomes a
// fleet-wide visitor identifier — exactly the cross-site correlation the daily
// rotation exists to make impossible, reintroduced across tenants instead of
// across days.
const cachedSalts = new TenantKeyedCache<string>()

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
  const cached = cachedSalts.get(dateKey)
  if (cached) return cached
  try {
    const redis = getRedis()
    const saltKey = tenantKey(`visitor:salt:${dateKey}`)
    const fresh = randomBytes(32).toString('hex')
    await redis.set(saltKey, fresh, 'EX', SALT_TTL_SECONDS, 'NX')
    const salt = await redis.get(saltKey)
    if (salt) cachedSalts.set(dateKey, salt)
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
