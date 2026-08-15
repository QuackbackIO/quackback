import {
  ENTITLEMENTS,
  minimumPlanFor,
  type EntitlementKey,
  type PlanId,
} from '@/lib/server/domains/settings'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'

export type UpgradeDescription = {
  entitlement: EntitlementKey | null
  feature: string
  requiredPlan: PlanId | null
  requiredPlanName: string | null
  headline: string
  body: string
}

/** Catalogue-backed copy for an entitlement. Plan names come from PLAN_CATALOGUE. */
export function describeEntitlementUpgrade(key: EntitlementKey): UpgradeDescription {
  const definition = ENTITLEMENTS[key]
  const plan = minimumPlanFor(key)
  const verb = definition.plural ? 'are' : 'is'
  if (!plan) {
    return {
      entitlement: key,
      feature: definition.friendly,
      requiredPlan: null,
      requiredPlanName: null,
      headline: 'This is a plan feature',
      body: `${definition.friendly} ${verb} not included in your plan.`,
    }
  }
  return {
    entitlement: key,
    feature: definition.friendly,
    requiredPlan: plan.id,
    requiredPlanName: plan.name,
    headline: `Upgrade to ${plan.name}`,
    body: `${definition.friendly} ${verb} ${plan.article} ${plan.name} feature. Upgrade to ${plan.name} to enable it.`,
  }
}

/** Named feature that is not an entitlement key (e.g. data export). */
export function describePlanUpgrade(feature: string, requiredPlan: PlanId): UpgradeDescription {
  const name = requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)
  return {
    entitlement: null,
    feature,
    requiredPlan,
    requiredPlanName: name,
    headline: `Upgrade to ${name}`,
    body: `${feature} is a ${name} feature. Upgrade to ${name} to enable it.`,
  }
}

/** The same plan object the billing cards render. */
export function cataloguePlanFor(
  catalogue: BillingCatalogue | null | undefined,
  planId: PlanId | null | undefined
): BillingCatalogue['plans'][number] | null {
  if (!catalogue || !planId) return null
  return catalogue.plans.find((plan) => plan.id === planId) ?? null
}

/** True for a 402 plan refusal from a server function or REST handler. */
export function isPlanRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as {
    statusCode?: unknown
    error?: unknown
    message?: unknown
    result?: unknown
  }
  if (record.statusCode === 402) return true
  if (record.error === 'tier_limit_exceeded' || record.error === 'entitlement_required') return true
  const message =
    error instanceof Error
      ? error.message
      : String(record.message ?? (record.error as { message?: unknown } | undefined)?.message ?? '')
  return (
    /upgrade to(?: \w+)? to enable it/i.test(message) ||
    /not (?:available|included) (?:in|on) your plan/i.test(message)
  )
}

/**
 * TanStack Start often delivers a thrown server-fn as HTTP 200 with an
 * error payload. Treat that as a failure so callers cannot toast success.
 */
export function throwIfServerFnFailed(result: unknown): void {
  if (result == null || typeof result !== 'object') return
  const record = result as { error?: unknown; message?: unknown }
  if (record.error === true || typeof record.error === 'string') {
    const message =
      typeof record.message === 'string'
        ? record.message
        : typeof record.error === 'string'
          ? record.error
          : 'Request failed'
    throw Object.assign(new Error(message), { statusCode: 402, error: record.error })
  }
  if (record.error && typeof record.error === 'object') {
    throwIfServerFnFailed(record.error)
  }
}
