import { createRouteContextMemo } from '@/lib/client/route-context-memo'
import {
  adminBillingLock,
  isAdminPathAllowedDuringTrialChoice,
} from '@/lib/shared/billing/plan-downgrade-lock'
import type { AdminBillingLockInputs } from '@/lib/server/domains/billing/pending-downgrade'

/**
 * The admin layout's billing lock, loaded only for a billing manager of a
 * workspace with plan billing, so no one else's admin bundle carries it.
 *
 * Its inputs are fetched once per route context and the path is decided here,
 * so a click (and the preloads around it) does not ask the server again. A
 * failed read holds nobody.
 */
const lockInputs = createRouteContextMemo<AdminBillingLockInputs | null>()

export async function holdOnBilling(pathname: string): Promise<boolean> {
  if (isAdminPathAllowedDuringTrialChoice(pathname)) return false
  const lock = await lockInputs
    .get(async () => {
      const { getAdminBillingLockFn } = await import('@/lib/server/functions/billing')
      return getAdminBillingLockFn()
    })
    .catch(() => null)
  if (!lock) return false
  return (
    adminBillingLock({
      pathname,
      pending: lock.pending,
      trialChoiceDueAt: lock.trialChoiceDueAt ? new Date(lock.trialChoiceDueAt) : null,
      now: new Date(),
    }) !== null
  )
}
