import { db, settings } from '@/lib/server/db'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import { OSS_TIER_LIMITS, type TierLimits } from './tier-limits.types'
import type { CloudConfig } from './cloud/cloud.types'

const NUMERIC_LIMIT_KEYS = [
  'maxBoards',
  'maxPosts',
  'maxTeamSeats',
  'maxStatusComponents',
  'maxCustomRoles',
  'maxSendingDomains',
  'aiTokensPerMonth',
  'apiRequestsPerMonth',
  'apiRequestsPerMinute',
] as const satisfies readonly (keyof TierLimits)[]

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
 * Add a trial's numeric allowances without ever tightening an operator-set
 * baseline. `null` means unlimited, so it wins in either input; otherwise the
 * larger allowance wins. Feature flags and operator notices stay untouched.
 */
export function overlayTrialLimits(baseline: TierLimits, trial: Partial<TierLimits>): TierLimits {
  const trialLimits = mergeTierLimits(trial)
  const effective = { ...baseline }
  for (const key of NUMERIC_LIMIT_KEYS) {
    const storedValue = baseline[key]
    const trialValue = trialLimits[key]
    effective[key] =
      storedValue === null || trialValue === null ? null : Math.max(storedValue, trialValue)
  }
  return effective
}

export function resolveEffectiveTierLimits(
  baseline: TierLimits,
  cloud: Pick<CloudConfig, 'enabled' | 'trialActive'>,
  proLimits: Partial<TierLimits> | null | undefined
): TierLimits {
  if (!cloud.enabled || !cloud.trialActive) return baseline
  if (!proLimits) {
    throw new Error('Cloud billing is missing BILLING_PRICES.pro.limits for Pro trials')
  }
  return overlayTrialLimits(baseline, proLimits)
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
  let baseline = cachedLimits.get(LIMITS_KEY)

  if (!baseline) {
    const rows = await db.select({ tierLimits: settings.tierLimits }).from(settings).limit(1)
    const raw = rows[0]?.tierLimits
    const stored: StoredTierLimits | null = raw ? (JSON.parse(raw) as StoredTierLimits) : null
    baseline = mergeTierLimits(stored)
    cachedLimits.set(LIMITS_KEY, baseline)
  }

  const { getCloudConfig } = await import('./cloud/cloud.service')
  const cloud = await getCloudConfig()
  if (!cloud.enabled || !cloud.trialActive) return baseline

  const { getBillingConfig } = await import('../billing/billing.config')
  const proLimits = getBillingConfig()?.catalogue.pro?.limits
  return resolveEffectiveTierLimits(baseline, cloud, proLimits)
}

/** Invalidate the active workspace's cache. Call when settings.tier_limits is written. */
export function invalidateTierLimitsCache(): void {
  cachedLimits.delete(LIMITS_KEY)
}
