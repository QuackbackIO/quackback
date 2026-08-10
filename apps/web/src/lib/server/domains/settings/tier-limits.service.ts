import { db, settings } from '@/lib/server/db'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
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

/**
 * Per workspace, because this is the billing ceiling.
 *
 * A shared entry means whichever workspace is read first sets everyone's
 * limits: a paid plan's allowances leak to a free one, or a free plan's caps
 * are enforced against a customer who paid to be rid of them. It is also
 * silent — nothing errors, the wrong number is simply believed — so it can only
 * be caught by asserting the separation directly.
 */
const cachedLimits = new WorkspaceKeyedCache<TierLimits>()
const LIMITS_KEY = 'limits'

/**
 * Resolve the active TierLimits for this workspace. Self-hosters with no
 * row in `settings.tier_limits` get OSS_TIER_LIMITS (unlimited everything).
 * The cache is invalidated when the row is written.
 */
export async function getTierLimits(): Promise<TierLimits> {
  const cached = cachedLimits.get(LIMITS_KEY)
  if (cached) return cached

  const rows = await db.select({ tierLimits: settings.tierLimits }).from(settings).limit(1)
  const raw = rows[0]?.tierLimits
  const stored: StoredTierLimits | null = raw ? (JSON.parse(raw) as StoredTierLimits) : null

  const limits = mergeTierLimits(stored)
  cachedLimits.set(LIMITS_KEY, limits)
  return limits
}

/** Invalidate the active workspace's cache. Call when settings.tier_limits is written. */
export function invalidateTierLimitsCache(): void {
  cachedLimits.delete(LIMITS_KEY)
}
