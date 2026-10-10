import { kvDel, kvGet, kvSet } from '@/lib/server/kv/pg-kv'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isAdminPathAllowedDuringDowngradeLock } from '@/lib/shared/billing/plan-downgrade-lock'
import { planRank } from '@/lib/shared/billing/plan-action'
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
 * True when a billing manager with a live quota-blocked downgrade tries to
 * leave settings (and the posts inbox). Stale rows for a plan the workspace
 * already sits on or below are dropped.
 */
export async function shouldLockAdminToBilling(
  pathname: string,
  permissions: readonly string[]
): Promise<boolean> {
  if (isAdminPathAllowedDuringDowngradeLock(pathname)) return false
  if (!permissions.includes(PERMISSIONS.BILLING_MANAGE)) return false
  const pending = await getPendingDowngrade()
  if (!pending) return false
  const { getCloudConfig } = await import('../settings/cloud/cloud.service')
  const cloud = await getCloudConfig()
  if (!cloud.enabled || !cloud.plan) {
    await clearPendingDowngrade()
    return false
  }
  if (planRank(cloud.plan) <= planRank(pending.planId)) {
    await clearPendingDowngrade()
    return false
  }
  return true
}
