import { createServerFn } from '@tanstack/react-start'
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'

/** The operator-set plan notice, or null. Read by the admin layout to
 *  render the notice banner. */
export const getPlanNotice = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlanNotice | null> => {
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const limits = await getTierLimits()
    return limits.notice ?? null
  }
)
