import type { StoredBillingProjection } from '@/lib/shared/db-types'
import {
  BILLING_STATUSES,
  ENTITLEMENT_KEYS,
  PLAN_IDS,
  canonicalPlanId,
  type BillingStatus,
  type PlanId,
} from './cloud.types'
import type { TierLimits } from '../tier-limits.types'

export const PROJECTED_LIMIT_KEYS = [
  'maxBoards',
  'maxPosts',
  'maxTeamSeats',
  'maxStatusComponents',
  'maxCustomRoles',
  'maxSendingDomains',
  'aiTokensPerMonth',
  'emailsPerMonth',
  'apiRequestsPerMonth',
  'apiRequestsPerMinute',
] as const satisfies readonly (keyof TierLimits)[]

export type ProjectedLimits = Pick<TierLimits, (typeof PROJECTED_LIMIT_KEYS)[number]>

export interface BillingProjection extends Omit<
  StoredBillingProjection,
  'effectivePlan' | 'subscriptionStatus' | 'entitlements'
> {
  effectivePlan: PlanId
  subscriptionStatus: BillingStatus | null
  entitlements: Partial<Record<(typeof ENTITLEMENT_KEYS)[number], boolean>>
  freeLimits: ProjectedLimits
  planLimits: ProjectedLimits
}

const PROJECTION_KEYS = new Set([
  'version',
  'effectivePlan',
  'trialStartedAt',
  'trialExpiresAt',
  'subscriptionStatus',
  'entitlements',
  'freeLimits',
  'planLimits',
  'planLimitsExpireAt',
  'canUpgrade',
  'canManageBilling',
  'renewalAt',
  'cancellationAt',
])
const PLAN_IDS_SET = new Set<string>(PLAN_IDS)
const BILLING_STATUSES_SET = new Set<string>(BILLING_STATUSES)
const ENTITLEMENT_KEYS_SET = new Set<string>(ENTITLEMENT_KEYS)
const LIMIT_KEYS_SET = new Set<string>(PROJECTED_LIMIT_KEYS)

function parseLimits(value: unknown): ProjectedLimits | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const limits = value as Record<string, unknown>
  if (Object.keys(limits).some((key) => !LIMIT_KEYS_SET.has(key))) return null
  const parsed = {} as ProjectedLimits
  for (const key of PROJECTED_LIMIT_KEYS) {
    if (!(key in limits)) {
      // Older control planes omit emailsPerMonth. Absent means unlimited,
      // same as every other numeric limit; do not drop the whole projection.
      if (key === 'emailsPerMonth') {
        parsed[key] = null
        continue
      }
      return null
    }
    const limit = limits[key]
    if (limit !== null && (!Number.isSafeInteger(limit) || Number(limit) < 0)) return null
    parsed[key] = limit as ProjectedLimits[typeof key]
  }
  return parsed
}

function parseEntitlements(
  value: unknown
): Partial<Record<(typeof ENTITLEMENT_KEYS)[number], boolean>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entitlements = value as Record<string, unknown>
  const parsed: Partial<Record<(typeof ENTITLEMENT_KEYS)[number], boolean>> = {}
  for (const [key, enabled] of Object.entries(entitlements)) {
    if (!ENTITLEMENT_KEYS_SET.has(key)) continue
    if (typeof enabled !== 'boolean') return null
    parsed[key as (typeof ENTITLEMENT_KEYS)[number]] = enabled
  }
  return parsed
}

function isNullableIsoDate(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

/**
 * Parse the deliberately narrow workspace projection. Unknown fields fail
 * closed so provider references, prices, and future authoritative state cannot
 * accidentally cross the control-plane boundary.
 */
export function parseBillingProjection(value: unknown): BillingProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const projection = value as Record<string, unknown>
  if (
    Object.keys(projection).length !== PROJECTION_KEYS.size ||
    Object.keys(projection).some((key) => !PROJECTION_KEYS.has(key))
  ) {
    return null
  }
  if (!Number.isSafeInteger(projection.version) || Number(projection.version) < 1) return null
  if (typeof projection.effectivePlan !== 'string') return null
  const effectivePlan = canonicalPlanId(projection.effectivePlan)
  if (!PLAN_IDS_SET.has(effectivePlan)) return null
  if (
    !isNullableIsoDate(projection.trialStartedAt) ||
    !isNullableIsoDate(projection.trialExpiresAt) ||
    !isNullableIsoDate(projection.planLimitsExpireAt) ||
    !isNullableIsoDate(projection.renewalAt) ||
    !isNullableIsoDate(projection.cancellationAt)
  ) {
    return null
  }
  if (
    projection.subscriptionStatus !== null &&
    (typeof projection.subscriptionStatus !== 'string' ||
      !BILLING_STATUSES_SET.has(projection.subscriptionStatus))
  ) {
    return null
  }
  const entitlements = parseEntitlements(projection.entitlements)
  const freeLimits = parseLimits(projection.freeLimits)
  const planLimits = parseLimits(projection.planLimits)
  if (!entitlements || !freeLimits || !planLimits) return null
  if (
    typeof projection.canUpgrade !== 'boolean' ||
    typeof projection.canManageBilling !== 'boolean'
  ) {
    return null
  }
  return { ...projection, effectivePlan, entitlements, freeLimits, planLimits } as BillingProjection
}

/** Preserve unlimited or higher operator limits while raising lower plan limits. */
export function overlayProjectedLimits(
  baseline: TierLimits,
  projected: ProjectedLimits
): TierLimits {
  const effective: TierLimits = { ...baseline, features: { ...baseline.features } }
  for (const key of PROJECTED_LIMIT_KEYS) {
    const baselineValue = baseline[key]
    const projectedValue = projected[key]
    effective[key] =
      baselineValue === null || projectedValue === null
        ? null
        : Math.max(baselineValue, projectedValue)
  }
  return effective
}

/** Exact-expiry resolution from local state; no control-plane call or sweeper. */
export function projectedLimitsAt(
  projection: BillingProjection,
  baseline: TierLimits,
  now = new Date()
): TierLimits {
  const projected =
    projection.planLimitsExpireAt && now.getTime() >= Date.parse(projection.planLimitsExpireAt)
      ? projection.freeLimits
      : projection.planLimits
  return overlayProjectedLimits(baseline, projected)
}
