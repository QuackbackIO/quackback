import { kvDel, kvGet, kvSet } from '@/lib/server/kv/pg-kv'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  adminBillingLock,
  isAdminPathAllowedDuringTrialChoice,
} from '@/lib/shared/billing/plan-downgrade-lock'
import { pendingDowngradeIsLive } from '@/lib/shared/billing/pending-downgrade-state'
import { trialChoiceDueAt } from '@/lib/shared/billing/trial-state'
import {
  canonicalPlanId,
  isPlanId,
  PLAN_CATALOGUE,
  type PlanId,
} from '@/lib/server/domains/settings/cloud/cloud.types'

const PENDING_KEY = 'billing:pending-downgrade'
const PENDING_TTL_SECONDS = 30 * 24 * 60 * 60

export type PendingDowngrade = { planId: PlanId }

function parsePending(value: unknown): PendingDowngrade | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const planId = canonicalPlanId(String((value as { planId?: unknown }).planId ?? ''))
  return isPlanId(planId) ? { planId } : null
}

export async function getPendingDowngrade(): Promise<PendingDowngrade | null> {
  return parsePending(await kvGet<unknown>(PENDING_KEY))
}

export async function setPendingDowngrade(planId: PlanId): Promise<void> {
  await kvSet(PENDING_KEY, { planId }, PENDING_TTL_SECONDS)
}

export async function clearPendingDowngrade(): Promise<void> {
  await kvDel(PENDING_KEY)
}

export function pendingPlanName(planId: PlanId, catalogueName?: string | null): string {
  return catalogueName && catalogueName.length > 0 ? catalogueName : PLAN_CATALOGUE[planId].name
}

/**
 * True when a billing manager must stay on billing pages: a quota-blocked
 * downgrade is pending and this path is outside the pages that resolve it, or
 * a trial ended two days ago and nobody has chosen a plan. Stale pending rows,
 * for a plan the workspace already sits on or below, are dropped.
 */
export async function shouldLockAdminToBilling(
  pathname: string,
  permissions: readonly string[],
  now: Date = new Date()
): Promise<boolean> {
  if (!permissions.includes(PERMISSIONS.BILLING_MANAGE)) return false
  // Both locks leave the plan picker open, so skip the reads there.
  if (isAdminPathAllowedDuringTrialChoice(pathname)) return false
  const { getCloudConfig } = await import('../settings/cloud/cloud.service')
  const [cloud, stored] = await Promise.all([getCloudConfig(), getPendingDowngrade()])
  if (!cloud.enabled || !cloud.plan) {
    if (stored) await clearPendingDowngrade()
    return false
  }
  const dueAt = trialChoiceDueAt({
    plan: cloud.plan,
    trialActive: cloud.trialActive,
    trialExpiresAt: cloud.trialExpiresAt,
    status: cloud.subscriptionStatus,
    now,
  })
  let pending = stored
  if (
    pending &&
    !pendingDowngradeIsLive({
      currentPlan: cloud.plan,
      pendingPlan: pending.planId,
      trialUndecided: dueAt !== null,
    })
  ) {
    await clearPendingDowngrade()
    pending = null
  }
  const lock = adminBillingLock({
    pathname,
    pendingDowngrade: pending !== null,
    // Only gate when the plan picker can act on the choice.
    trialChoiceDueAt: cloud.canUpgrade ? dueAt : null,
    now,
  })
  return lock !== null
}
