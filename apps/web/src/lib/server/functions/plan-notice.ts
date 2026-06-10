import { createServerFn } from '@tanstack/react-start'
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'
import { requireAuth } from './auth-helpers'

/** The operator-set plan notice, or null. Read by the admin layout to
 *  render the notice banner. Team-only: the notice can carry billing or
 *  maintenance details, so the RPC endpoint must not leak it to portal
 *  users or anonymous callers. */
export const getPlanNotice = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlanNotice | null> => {
    await requireAuth({ roles: ['admin', 'member'] })
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const limits = await getTierLimits()
    return limits.notice ?? null
  }
)
