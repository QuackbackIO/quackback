import { IS_CLOUD } from '../../edition'
import { OSS_TIER_LIMITS, type TierLimits } from './tier-limits.types'

export type StoredTierLimits = Partial<Omit<TierLimits, 'features'>> & {
  features?: Partial<TierLimits['features']>
}

export function mergeTierLimits(stored: StoredTierLimits | null): TierLimits {
  if (!stored) return OSS_TIER_LIMITS
  return {
    ...OSS_TIER_LIMITS,
    ...stored,
    features: {
      ...OSS_TIER_LIMITS.features,
      ...(stored.features ?? {}),
    },
  }
}

let cachedLimits: TierLimits | null = null

export async function getTierLimits(): Promise<TierLimits> {
  // Checkpoint 1: OSS short-circuit. No DB read, no cache, no allocation.
  // Returns the constant by reference so callers can === compare against
  // OSS_TIER_LIMITS as a sanity check.
  if (!IS_CLOUD) return OSS_TIER_LIMITS

  if (cachedLimits) return cachedLimits

  // Lazy import the DB layer so the OSS short-circuit above stays cheap.
  const [{ db, settings }] = await Promise.all([import('@/lib/server/db')])
  const rows = await db.select({ tierLimits: settings.tierLimits }).from(settings).limit(1)
  const raw = rows[0]?.tierLimits
  const stored: StoredTierLimits | null = raw ? (JSON.parse(raw) as StoredTierLimits) : null

  cachedLimits = mergeTierLimits(stored)
  return cachedLimits
}

/** Invalidate the in-process cache. Call when settings.tier_limits is written. */
export function invalidateTierLimitsCache(): void {
  cachedLimits = null
}
