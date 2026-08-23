import { getCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { PLAN_CATALOGUE, type PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'

export interface BillingProjectionOverview {
  plan: PlanId
  planName: string
  status: string | null
  trialActive: boolean
  trialExpiresAt: string | null
  renewalAt: string | null
  cancellationAt: string | null
  canUpgrade: boolean
  canManageBilling: boolean
  purchasablePlans: Array<{ id: Exclude<PlanId, 'free'>; name: string }>
}

export async function getBillingProjectionOverview(): Promise<BillingProjectionOverview | null> {
  const cloud = await getCloudConfig()
  if (!cloud.enabled || !cloud.plan) return null
  return {
    plan: cloud.plan,
    planName: PLAN_CATALOGUE[cloud.plan].name,
    status: cloud.subscriptionStatus,
    trialActive: cloud.trialActive,
    trialExpiresAt: cloud.trialExpiresAt,
    renewalAt: cloud.renewalAt,
    cancellationAt: cloud.cancellationAt,
    canUpgrade: cloud.canUpgrade,
    canManageBilling: cloud.canManageBilling,
    purchasablePlans: (['growth', 'pro', 'scale'] as const).map((id) => ({
      id,
      name: PLAN_CATALOGUE[id].name,
    })),
  }
}
