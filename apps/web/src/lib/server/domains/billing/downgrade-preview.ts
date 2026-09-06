import type { BillingProjectionOverview } from './projection-overview'
import { pendingPlanName } from './pending-downgrade'
import {
  featuresDisabledOnDowngrade,
  planDowngradeIssues,
  type PlanDowngradeIssue,
} from '@/lib/shared/billing/plan-downgrade'
import type { PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'

export type DowngradePreview = {
  planId: PlanId
  planName: string
  issues: PlanDowngradeIssue[]
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
    planName: pendingPlanName(input.planId, catalogueName),
    issues: planDowngradeIssues(input.used, input.planId),
    featuresDisabled: featuresDisabledOnDowngrade(
      input.overview?.trialPlanId ?? input.overview?.plan,
      input.planId
    ),
  }
}
