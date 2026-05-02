import { db, settings } from '@/lib/server/db'
import { OSS_TIER_LIMITS, type TierLimits } from './tier-limits.types'

type StoredTierLimits = Partial<Omit<TierLimits, 'features'>> & {
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

/**
 * Resolve the active TierLimits for this workspace. Self-hosters with no
 * row in `settings.tier_limits` get OSS_TIER_LIMITS (unlimited everything).
 * The cache is invalidated when the row is written.
 */
export async function getTierLimits(): Promise<TierLimits> {
  if (cachedLimits) return cachedLimits

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
