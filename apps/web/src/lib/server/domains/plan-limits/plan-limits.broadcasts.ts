/**
 * Broadcasts held back because the month's email cap is used up.
 *
 * A changelog or status broadcast that finds the cap used up is skipped. With
 * plan limits on, each skipped broadcast is recorded once for the month, in
 * the key-value store's set so two deliveries of the same broadcast (one per
 * recipient, on any replica) count once. The first record logs a warning, and
 * the Plan limits page adds the count to its used-up email row.
 */
import { kvSetCount, kvSetMemberClaim } from '@/lib/server/kv/pg-kv'
import { getFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'plan-limits' })

const MONTH_TTL_SECONDS = 40 * 24 * 60 * 60

function setKey(now: Date): string {
  return `plan-limits:skipped-broadcasts:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Record a skipped broadcast. True the first time this broadcast is seen this
 * month, false for a repeat, null when plan limits are off or the record
 * could not be made (the caller then logs as it always has).
 */
export async function recordSkippedBroadcast(
  eventId: string,
  now: Date = new Date()
): Promise<boolean | null> {
  try {
    if ((await getFeatureFlags()).planLimits !== true) return null
    return await kvSetMemberClaim(setKey(now), eventId, MONTH_TTL_SECONDS)
  } catch (err) {
    log.warn({ err }, 'recording a skipped broadcast failed')
    return null
  }
}

/** How many broadcasts were skipped this month. Zero when it cannot be read. */
export async function skippedBroadcastCount(now: Date = new Date()): Promise<number> {
  try {
    return await kvSetCount(setKey(now))
  } catch (err) {
    log.warn({ err }, 'reading skipped broadcasts failed')
    return 0
  }
}
