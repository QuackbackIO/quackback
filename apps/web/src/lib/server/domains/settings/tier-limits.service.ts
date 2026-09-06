import { db, settings } from '@/lib/server/db'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import { OSS_TIER_LIMITS, type TierLimits } from './tier-limits.types'
import {
  parseBillingProjection,
  projectedLimitsAt,
  type BillingProjection,
  type ProjectedLimits,
} from './cloud/billing-projection'
import { canonicalPlanId, isPlanId, type PlanId } from './cloud/cloud.types'

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

const CLOSED_CLOUD_FEATURES: TierLimits['features'] = {
  customDomain: false,
  customOidcProvider: false,
  ipAllowlist: false,
  webhooks: false,
  mcpServer: false,
  analyticsExports: false,
  customColors: false,
  customCss: false,
  integrations: false,
}

/**
 * Feature flags that are not entitlements. Must match CP `definitions.ts`
 * for the same plan. Copied from `effectivePlan` because the projection
 * entitlements map does not carry these keys.
 */
const PLAN_ONLY_FEATURES: Record<
  PlanId,
  Pick<TierLimits['features'], 'analyticsExports' | 'customColors' | 'customCss' | 'integrations'>
> = {
  free: {
    analyticsExports: false,
    customColors: true,
    customCss: false,
    integrations: false,
  },
  pro: {
    analyticsExports: false,
    customColors: true,
    customCss: false,
    integrations: false,
  },
  business: {
    analyticsExports: true,
    customColors: true,
    customCss: true,
    integrations: true,
  },
  enterprise: {
    analyticsExports: true,
    customColors: true,
    customCss: true,
    integrations: true,
  },
}

/** Numeric floor from a projection when the operator has not written a row. */
export function cloudProjectionFloor(limits: ProjectedLimits): TierLimits {
  return {
    maxBoards: limits.maxBoards,
    maxPosts: limits.maxPosts,
    maxTeamSeats: limits.maxTeamSeats,
    maxStatusComponents: limits.maxStatusComponents,
    maxCustomRoles: limits.maxCustomRoles,
    maxSendingDomains: limits.maxSendingDomains,
    aiTokensPerMonth: limits.aiTokensPerMonth,
    emailsPerMonth: limits.emailsPerMonth,
    apiRequestsPerMonth: limits.apiRequestsPerMonth,
    apiRequestsPerMinute: limits.apiRequestsPerMinute,
    features: { ...CLOSED_CLOUD_FEATURES },
  }
}

function featuresFromProjection(projection: BillingProjection, now: Date): TierLimits['features'] {
  const expired =
    projection.planLimitsExpireAt !== null &&
    now.getTime() >= Date.parse(projection.planLimitsExpireAt)
  const entitlements = expired ? {} : projection.entitlements
  const resolved = expired ? 'free' : canonicalPlanId(projection.effectivePlan)
  const planId: PlanId = isPlanId(resolved) ? resolved : 'free'
  return {
    ...CLOSED_CLOUD_FEATURES,
    ...PLAN_ONLY_FEATURES[planId],
    customDomain: entitlements.customDomain === true,
    customOidcProvider: entitlements.sso === true,
    webhooks: entitlements.webhooks === true,
    mcpServer: entitlements.mcpServer === true,
  }
}

/**
 * Apply a signed billing projection on top of an optional operator row.
 *
 * No row + cloud off (no projection) stays OSS unlimited. No row + a
 * projection must not inherit that unlimited default — otherwise every
 * cloud Free/Pro workspace is uncapped.
 */
export function resolveEffectiveTierLimits(
  stored: StoredTierLimits | null,
  projection: BillingProjection | null,
  now = new Date()
): TierLimits {
  if (!projection) return mergeTierLimits(stored)
  const baseline = stored ? mergeTierLimits(stored) : cloudProjectionFloor(projection.freeLimits)
  const numeric = projectedLimitsAt(projection, baseline, now)
  if (stored) return numeric
  return { ...numeric, features: featuresFromProjection(projection, now) }
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
interface CachedLimits {
  stored: StoredTierLimits | null
  projection: BillingProjection | null
}

const cachedLimits = new WorkspaceKeyedCache<CachedLimits>()
const LIMITS_KEY = 'limits'

/**
 * Resolve the active TierLimits for this workspace. Self-hosters with no
 * row in `settings.tier_limits` get OSS_TIER_LIMITS (unlimited everything).
 * Cloud workspaces apply the signed projection instead of that default.
 * The cache is invalidated when the row is written.
 */
export async function getTierLimits(now = new Date()): Promise<TierLimits> {
  let cached = cachedLimits.get(LIMITS_KEY)

  if (!cached) {
    const rows = await db
      .select({ tierLimits: settings.tierLimits, cloud: settings.cloud })
      .from(settings)
      .limit(1)
    const raw = rows[0]?.tierLimits
    const stored: StoredTierLimits | null = raw ? (JSON.parse(raw) as StoredTierLimits) : null
    const rawProjection = rows[0]?.cloud?.projection
    cached = {
      stored,
      projection: parseBillingProjection(rawProjection),
    }
    cachedLimits.set(LIMITS_KEY, cached)
  }

  return resolveEffectiveTierLimits(cached.stored, cached.projection, now)
}

/** Invalidate the active workspace's cache. Call when settings.tier_limits is written. */
export function invalidateTierLimitsCache(): void {
  cachedLimits.delete(LIMITS_KEY)
}
