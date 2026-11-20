/**
 * The plan's name for the copy that says what the plan locks, pauses or
 * hides: "Custom roles are locked on the Free plan." Copy names the plan, so
 * this reads it once and returns null when it is unknown (no billing
 * projection, or a failed read), where callers drop the plan from the sentence.
 */
import { PLAN_CATALOGUE } from '@/lib/server/domains/settings/cloud/cloud.types'
import { getPlanLimits } from './plan-limits.service'

/** The current plan's display name, or null. Never throws. */
export async function currentPlanName(): Promise<string | null> {
  try {
    const { plan } = await getPlanLimits()
    return plan ? PLAN_CATALOGUE[plan].name : null
  } catch {
    return null
  }
}

/** " on the Free plan", or "" when the plan is unknown. */
export function onThePlan(planName: string | null): string {
  return planName ? ` on the ${planName} plan` : ''
}
