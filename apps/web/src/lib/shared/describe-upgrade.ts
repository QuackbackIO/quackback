import {
  ENTITLEMENTS,
  PLAN_CATALOGUE,
  canonicalPlanId,
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
  /** Feature-first: names what was just attempted and the plan that includes it. */
  headline: string
  /** One plain sentence. Screen-reader description and the fallback when no plan is known. */
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
      headline: `${definition.friendly} ${verb} not included in your plan`,
      body: `${definition.friendly} ${verb} not included in your plan. Contact us to add ${definition.plural ? 'them' : 'it'}.`,
    }
  }
  return {
    entitlement: key,
    feature: definition.friendly,
    requiredPlan: plan.id,
    requiredPlanName: plan.name,
    headline: `${definition.friendly} ${verb} available from the ${plan.name} plan`,
    body: `${definition.friendly} ${verb} ${plan.article} ${plan.name} feature. Upgrade to ${plan.name} to enable ${definition.plural ? 'them' : 'it'}.`,
  }
}

/**
 * Named feature that is not an entitlement key (e.g. data export). Pass
 * `plural` for names that take "are" ("Custom colours", "Integrations").
 */
export function describePlanUpgrade(
  feature: string,
  requiredPlan: PlanId,
  options: { plural?: boolean } = {}
): UpgradeDescription {
  const plan = PLAN_CATALOGUE[requiredPlan]
  const verb = options.plural ? 'are' : 'is'
  return {
    entitlement: null,
    feature,
    requiredPlan,
    requiredPlanName: plan.name,
    headline: `${feature} ${verb} available from the ${plan.name} plan`,
    body: `${feature} ${verb} ${plan.article} ${plan.name} feature. Upgrade to ${plan.name} to enable ${options.plural ? 'them' : 'it'}.`,
  }
}

/** The sentence that introduces the unlock list, naming both ends of the move when known. */
export function upgradeLead(
  currentPlanName: string | null | undefined,
  requiredPlanName: string | null | undefined,
  options: { trialActive?: boolean } = {}
): string {
  if (!requiredPlanName) return 'Upgrade your plan to unlock:'
  if (currentPlanName && currentPlanName !== requiredPlanName) {
    return options.trialActive
      ? `You're trialing ${currentPlanName}. Upgrade to ${requiredPlanName} to unlock:`
      : `Upgrade from ${currentPlanName} to ${requiredPlanName} to unlock:`
  }
  return `Upgrade to ${requiredPlanName} to unlock:`
}

export type UnlockedHighlights = {
  /** What the required plan itself adds. Shown as the checklist. */
  target: string[]
  /** Plans between the current one and the target, cheapest first, whose highlights come along. */
  included: Array<{ planName: string; highlights: string[] }>
}

/**
 * Everything the workspace gains by moving from `currentPlan` to `requiredPlan`.
 * Catalogue highlights are incremental per plan, so a Free → Business move also
 * brings Pro's list. Unknown current plan means only the target's list.
 */
export function unlockedHighlights(
  catalogue: BillingCatalogue | null | undefined,
  currentPlan: PlanId | null | undefined,
  requiredPlan: PlanId | null | undefined
): UnlockedHighlights {
  const target = cataloguePlanFor(catalogue, requiredPlan)
  if (!catalogue || !target) return { target: [], included: [] }
  const floor = currentPlan ? PLAN_CATALOGUE[currentPlan].rank : target.rank - 1
  const included = catalogue.plans
    .filter((plan) => plan.rank > floor && plan.rank < target.rank)
    .sort((a, b) => a.rank - b.rank)
    .map((plan) => ({ planName: plan.name, highlights: [...plan.highlights] }))
  return { target: [...target.highlights], included }
}

/** The same plan object the billing cards render. */
export function cataloguePlanFor(
  catalogue: BillingCatalogue | null | undefined,
  planId: PlanId | null | undefined
): BillingCatalogue['plans'][number] | null {
  if (!catalogue || !planId) return null
  return catalogue.plans.find((plan) => canonicalPlanId(plan.id) === planId) ?? null
}

function refusalMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  if (error instanceof Error) return error.message
  const record = error as { message?: unknown; error?: unknown }
  return String(
    record.message ?? (record.error as { message?: unknown } | undefined)?.message ?? ''
  )
}

/** True for a 402 plan refusal from a server function or REST handler. */
export function isPlanRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as {
    statusCode?: unknown
    error?: unknown
  }
  if (record.statusCode === 402) return true
  if (record.error === 'tier_limit_exceeded' || record.error === 'entitlement_required') return true
  const message = refusalMessage(error)
  return (
    /upgrade to(?: \w+)? to enable it/i.test(message) ||
    /not (?:available|included) (?:in|on) your plan/i.test(message)
  )
}

/**
 * Copy for the feature the server actually refused, so a save that trips on
 * Custom CSS does not open a prompt about Custom colours. Reads the refusal
 * sentence both gates produce; anything unrecognised keeps `fallback`.
 */
export function describePlanRefusal(
  error: unknown,
  fallback: UpgradeDescription
): UpgradeDescription {
  const message = refusalMessage(error)
  const entitled = /^(.+?) (is|are) an? (\w+) feature\./.exec(message)
  if (entitled) {
    const [, feature, verb, planName] = entitled
    const plan = Object.values(PLAN_CATALOGUE).find((candidate) => candidate.name === planName)
    if (plan) return describePlanUpgrade(feature, plan.id, { plural: verb === 'are' })
  }
  const capped = /^(.+?) (is|are) not available (?:in|on) your plan\./.exec(message)
  if (capped && fallback.requiredPlan) {
    const [, feature, verb] = capped
    return describePlanUpgrade(feature, fallback.requiredPlan, { plural: verb === 'are' })
  }
  return fallback
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
