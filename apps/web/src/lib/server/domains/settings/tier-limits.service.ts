import { db, settings } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import { settingsLocalTtlMs } from '@/lib/server/local-cache'
import { OSS_TIER_LIMITS, PLAN_ONLY_FEATURES, type TierLimits } from './tier-limits.types'
import {
  entitlementsAt,
  parseBillingProjection,
  projectedLimitsAt,
  projectionAccessEnded,
  type BillingProjection,
  type ProjectedLimits,
} from './cloud/billing-projection'
import { canonicalPlanId, isPlanId, type EntitlementKey, type PlanId } from './cloud/cloud.types'

const log = logger.child({ component: 'tier-limits-service' })

type StoredTierLimits = Partial<Omit<TierLimits, 'features'>> & {
  features?: Partial<TierLimits['features']>
}

/**
 * Parse stored `tier_limits` JSON, tolerating corruption. Absent is the
 * documented "no row" state (self-hosters get {@link OSS_TIER_LIMITS};
 * cloud workspaces get the signed projection's floor — see
 * {@link resolveEffectiveTierLimits}). Unparseable or non-object JSON is
 * corrupt data: logged once so it can be found and repaired, and treated
 * the same as "no row" rather than throwing on every tier-limit check.
 */
function parseStoredTierLimits(raw: string | null | undefined): StoredTierLimits | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    log.error(
      { err, column: 'tier_limits' },
      'unreadable tier_limits JSON, treating as no stored row'
    )
    return null
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    log.error(
      { column: 'tier_limits', valueType: Array.isArray(parsed) ? 'array' : typeof parsed },
      'tier_limits JSON was not an object, treating as no stored row'
    )
    return null
  }

  return parsed as StoredTierLimits
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
  visitorAnalytics: false,
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
    maxInboundEmailAddresses: limits.maxInboundEmailAddresses,
    maxHelpCenterLocales: limits.maxHelpCenterLocales,
    maxStatusSubscribers: limits.maxStatusSubscribers,
    apiRequestsPerMonth: limits.apiRequestsPerMonth,
    apiRequestsPerMinute: limits.apiRequestsPerMinute,
    features: { ...CLOSED_CLOUD_FEATURES },
  }
}

/** The tier features a projection's entitlement switches on. */
export const ENTITLEMENT_TIER_FEATURES = {
  customDomain: 'customDomain',
  sso: 'customOidcProvider',
  webhooks: 'webhooks',
  mcpServer: 'mcpServer',
} as const satisfies Partial<Record<EntitlementKey, keyof TierLimits['features']>>

function featuresFromProjection(projection: BillingProjection, now: Date): TierLimits['features'] {
  const entitlements = entitlementsAt(projection, now)
  const resolved = projectionAccessEnded(projection, now)
    ? 'free'
    : canonicalPlanId(projection.effectivePlan)
  const planId: PlanId = isPlanId(resolved) ? resolved : 'free'
  const features: TierLimits['features'] = {
    ...CLOSED_CLOUD_FEATURES,
    ...PLAN_ONLY_FEATURES[planId],
  }
  for (const [entitlement, feature] of Object.entries(ENTITLEMENT_TIER_FEATURES)) {
    features[feature] = entitlements[entitlement as EntitlementKey] === true
  }
  return features
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
  /** When this copy stops being served (see {@link getTierLimits}). */
  expiresAt: number
}

const cachedLimits = new WorkspaceKeyedCache<CachedLimits>()
const LIMITS_KEY = 'limits'

/**
 * Resolve the active TierLimits for this workspace. Self-hosters with no
 * row in `settings.tier_limits` get OSS_TIER_LIMITS (unlimited everything).
 * Cloud workspaces apply the signed projection instead of that default.
 *
 * The row is held in this process for the settings window
 * (`settingsLocalTtlMs`, a few seconds). A write drops the copy at once in the
 * process that made it; every other process (other web replicas, the worker)
 * reads the row again when its copy expires, so a plan change reaches all of
 * them within that window, as a settings change does.
 */
export async function getTierLimits(now = new Date()): Promise<TierLimits> {
  let cached = cachedLimits.get(LIMITS_KEY)
  if (cached && cached.expiresAt <= Date.now()) cached = undefined

  if (!cached) {
    const rows = await db
      .select({ tierLimits: settings.tierLimits, cloud: settings.cloud })
      .from(settings)
      .limit(1)
    const raw = rows[0]?.tierLimits
    const stored = parseStoredTierLimits(raw)
    const rawProjection = rows[0]?.cloud?.projection
    cached = {
      stored,
      projection: parseBillingProjection(rawProjection),
      expiresAt: Date.now() + settingsLocalTtlMs(),
    }
    cachedLimits.set(LIMITS_KEY, cached)
  }

  return resolveEffectiveTierLimits(cached.stored, cached.projection, now)
}

/** Invalidate the active workspace's cache. Call when settings.tier_limits is written. */
export function invalidateTierLimitsCache(): void {
  cachedLimits.delete(LIMITS_KEY)
}

/**
 * The limits a settings row resolves to at `at`, without the cache: for
 * looking back at the limits in force before a drop.
 */
export function resolveTierLimitsFromRow(
  rawTierLimits: string | null | undefined,
  rawProjection: unknown,
  at: Date
): TierLimits {
  return resolveEffectiveTierLimits(
    parseStoredTierLimits(rawTierLimits),
    parseBillingProjection(rawProjection),
    at
  )
}
