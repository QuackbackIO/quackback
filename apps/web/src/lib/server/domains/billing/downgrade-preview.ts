import type { BillingProjectionOverview } from './projection-overview'
import {
  featuresDisabledOnDowngrade,
  planDowngradeInfo,
  planDowngradeIssues,
  type PlanCapInfo,
  type PlanDowngradeIssue,
} from '@/lib/shared/billing/plan-downgrade'
import { PLAN_CATALOGUE, type PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'

function planNameFor(planId: PlanId, catalogueName?: string | null): string {
  return catalogueName && catalogueName.length > 0 ? catalogueName : PLAN_CATALOGUE[planId].name
}

export type DowngradePreview = {
  planId: PlanId
  planName: string
  /** What must be removed before the switch. */
  issues: PlanDowngradeIssue[]
  /** Over a cap that never blocks the switch (posts): shown only. */
  info: PlanCapInfo[]
  featuresDisabled: string[]
}

export async function loadDowngradePreview(input: {
  planId: PlanId
  overview: BillingProjectionOverview | null
  used: Record<string, number>
}): Promise<DowngradePreview> {
  const { fetchBillingCatalogue } = await import('@/lib/server/control-plane/client')
  const catalogue = await fetchBillingCatalogue().catch(() => null)
  const catalogueName = catalogue?.plans.find((plan) => plan.id === input.planId)?.name
  return {
    planId: input.planId,
    planName: planNameFor(input.planId, catalogueName),
    issues: planDowngradeIssues(input.used, input.planId),
    info: planDowngradeInfo(input.used, input.planId),
    featuresDisabled: featuresDisabledOnDowngrade(
      input.overview?.trialPlanId ?? input.overview?.plan,
      input.planId
    ),
  }
}
