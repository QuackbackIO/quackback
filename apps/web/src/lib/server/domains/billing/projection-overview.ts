import { getCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { PLAN_CATALOGUE, type PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'
import type { BillingCatalogue, CataloguePlanId } from '@/lib/server/control-plane/client'

export type BillingSeatsOverview = {
  used: number
  pending: number
  members: number
  purchased: number | null
}

export type BillingAiOverview = {
  includedCents: number
  usedCents: number
  extraCents: number
}

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
  seats: BillingSeatsOverview
  ai: BillingAiOverview | null
}

export function composeAiUsage(input: {
  usedTokens: number
  tokenCap: number | null
  includedCents: number
  blendedCentsPerMTok: number
}): BillingAiOverview {
  const rate = input.blendedCentsPerMTok
  const usedCents = rate > 0 ? Math.round((input.usedTokens * rate) / 1_000_000) : 0
  const includedTokens = rate > 0 ? (input.includedCents * 1_000_000) / rate : 0
  const extraTokens = input.tokenCap != null ? Math.max(0, input.tokenCap - includedTokens) : 0
  const extraCents = rate > 0 ? Math.round((extraTokens * rate) / 1_000_000) : 0
  return { includedCents: input.includedCents, usedCents, extraCents }
}

export function catalogueAiIncludedCents(
  catalogue: BillingCatalogue | null,
  plan: PlanId
): number | null {
  const value = catalogue?.aiIncludedCentsPerMonth?.[plan as CataloguePlanId]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Purchased seats are the billed projection quantity, not the operator
 * tier_limits overlay that getTierLimits() applies for enforcement.
 * Free, trial, workspace-billed, and missing billedPer (grandfathered /
 * catalogue unavailable) stay null so Add seats cannot target an overlay.
 */
export function purchasedSeatsFromProjection(input: {
  billedPer: 'seat' | 'workspace' | undefined
  plan: PlanId
  trialActive: boolean
  planLimitsMaxTeamSeats: number | null
}): number | null {
  if (input.billedPer !== 'seat' || input.plan === 'free' || input.trialActive) {
    return null
  }
  return input.planLimitsMaxTeamSeats
}

async function projectedPlanLimitsMaxTeamSeats(): Promise<number | null> {
  const { db, settings } = await import('@/lib/server/db')
  const { parseBillingProjection } =
    await import('@/lib/server/domains/settings/cloud/billing-projection')
  const [row] = await db.select({ cloud: settings.cloud }).from(settings).limit(1)
  return parseBillingProjection(row?.cloud?.projection)?.planLimits.maxTeamSeats ?? null
}

export async function getBillingProjectionOverview(): Promise<BillingProjectionOverview | null> {
  const cloud = await getCloudConfig()
  if (!cloud.enabled || !cloud.plan) return null

  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const { countSeatUsage } = await import('@/lib/server/domains/principals/seat-usage')
  const { aiTokensThisMonth } = await import('@/lib/server/domains/ai/usage-counter')

  const [limits, seats, usedTokens, catalogue, planLimitsMaxTeamSeats] = await Promise.all([
    getTierLimits(),
    countSeatUsage(),
    aiTokensThisMonth(),
    loadCatalogue(),
    projectedPlanLimitsMaxTeamSeats(),
  ])

  const billedPer = catalogue?.plans.find((plan) => plan.id === cloud.plan)?.billedPer
  const purchased = purchasedSeatsFromProjection({
    billedPer,
    plan: cloud.plan,
    trialActive: cloud.trialActive,
    planLimitsMaxTeamSeats,
  })
  const includedCents = catalogueAiIncludedCents(catalogue, cloud.plan)
  const blended = catalogue?.aiBlendedCentsPerMTok
  const ai =
    includedCents != null && typeof blended === 'number' && blended > 0
      ? composeAiUsage({
          usedTokens,
          tokenCap: limits.aiTokensPerMonth,
          includedCents,
          blendedCentsPerMTok: blended,
        })
      : null

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
    seats: {
      used: seats.used,
      pending: seats.pendingInvites,
      members: seats.members,
      purchased,
    },
    ai,
  }
}

async function loadCatalogue(): Promise<BillingCatalogue | null> {
  try {
    const { fetchBillingCatalogue } = await import('@/lib/server/control-plane/client')
    return await fetchBillingCatalogue()
  } catch {
    return null
  }
}
