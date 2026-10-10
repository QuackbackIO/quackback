import { kvDel, kvGet, kvSet } from '@/lib/server/kv/pg-kv'
import { PERMISSIONS } from '@/lib/shared/permissions'
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

/** A started downgrade, and the admin pages that resolve what is over its limits. */
export type PendingDowngrade = { planId: PlanId; cleanupPaths: string[] }

function parsePending(value: unknown): PendingDowngrade | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as { planId?: unknown; cleanupPaths?: unknown }
  const planId = canonicalPlanId(String(raw.planId ?? ''))
  if (!isPlanId(planId)) return null
  const cleanupPaths = Array.isArray(raw.cleanupPaths)
    ? raw.cleanupPaths.filter(
        (path): path is string => typeof path === 'string' && path.startsWith('/admin/')
      )
    : []
  return { planId, cleanupPaths }
}

export async function getPendingDowngrade(): Promise<PendingDowngrade | null> {
  return parsePending(await kvGet<unknown>(PENDING_KEY))
}

export async function setPendingDowngrade(
  planId: PlanId,
  cleanupHrefs: string[] = []
): Promise<void> {
  // Paths only: an issue link may carry a query, and the lock matches pages.
  const cleanupPaths = [...new Set(cleanupHrefs.map((href) => href.split(/[?#]/)[0]!))]
  await kvSet(PENDING_KEY, { planId, cleanupPaths }, PENDING_TTL_SECONDS)
}

export async function clearPendingDowngrade(): Promise<void> {
  await kvDel(PENDING_KEY)
}

export function pendingPlanName(planId: PlanId, catalogueName?: string | null): string {
  return catalogueName && catalogueName.length > 0 ? catalogueName : PLAN_CATALOGUE[planId].name
}

/** What the admin layout needs to decide, per path, whether to hold a billing manager on billing. */
export interface AdminBillingLockInputs {
  pending: { planId: PlanId; cleanupPaths: string[] } | null
  /** ISO. Set only while an ended trial waits on a choice the plan picker can take. */
  trialChoiceDueAt: string | null
}

/**
 * The billing lock's inputs for this viewer, or null when nothing can lock
 * them: they cannot manage billing, or the workspace has no plan billing.
 * Stale pending rows, for a plan the workspace already sits on or below, are
 * dropped here. The admin layout decides per path with `adminBillingLock`.
 */
export async function loadAdminBillingLock(
  permissions: readonly string[],
  now: Date = new Date()
): Promise<AdminBillingLockInputs | null> {
  if (!permissions.includes(PERMISSIONS.BILLING_MANAGE)) return null
  const { getCloudConfig } = await import('../settings/cloud/cloud.service')
  const [cloud, stored] = await Promise.all([getCloudConfig(), getPendingDowngrade()])
  if (!cloud.enabled || !cloud.plan) {
    if (stored) await clearPendingDowngrade()
    return null
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
  return {
    pending,
    // Only hold anyone when the plan picker can act on the choice.
    trialChoiceDueAt: dueAt && cloud.canUpgrade ? dueAt.toISOString() : null,
  }
}
